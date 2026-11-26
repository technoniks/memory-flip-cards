import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import express from "express";
import { rateLimit } from "express-rate-limit";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(currentDirectory, "..");
const databasePath = path.resolve(
  process.env.DB_PATH || path.join(projectDirectory, "data", "flashcards.sqlite"),
);
const port = Number(process.env.PORT || 3001);
const sessionCookieName = "flashcards_session";
const sessionDurationMs = 30 * 24 * 60 * 60 * 1000;
const passwordKeyLength = 64;
const scryptAsync = promisify(scrypt);
const dummySalt = randomBytes(16);
const app = express();

mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new Database(databasePath);
database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");
database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_salt TEXT,
    password_hash TEXT,
    is_guest INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS decks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, name)
  );

  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    term TEXT NOT NULL,
    definition TEXT NOT NULL,
    mastered INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions(expires_at);
`);

const cardColumns = database.pragma("table_info(cards)");
if (!cardColumns.some((column) => column.name === "deck_id")) {
  database.exec(
    "ALTER TABLE cards ADD COLUMN deck_id INTEGER REFERENCES decks(id) ON DELETE CASCADE",
  );
}

database.exec("CREATE INDEX IF NOT EXISTS cards_by_user_deck ON cards(user_id, deck_id, id)");

const findUserById = database.prepare(
  "SELECT id, email, display_name, is_guest FROM users WHERE id = ?",
);
const findDeckForUser = database.prepare(
  "SELECT id, user_id, name, created_at FROM decks WHERE id = ? AND user_id = ?",
);
const findFirstDeckForUser = database.prepare(
  "SELECT id, user_id, name, created_at FROM decks WHERE user_id = ? ORDER BY id LIMIT 1",
);
const insertDeck = database.prepare(
  "INSERT INTO decks (user_id, name, created_at) VALUES (?, ?, ?)",
);
const countDecksForUser = database.prepare(
  "SELECT COUNT(*) AS count FROM decks WHERE user_id = ?",
);
const listDecksForUser = database.prepare(
  `SELECT decks.id, decks.name, COUNT(cards.id) AS card_count
   FROM decks
   LEFT JOIN cards ON cards.deck_id = decks.id AND cards.user_id = decks.user_id
   WHERE decks.user_id = ?
   GROUP BY decks.id
   ORDER BY decks.id`,
);
const updateUnassignedCards = database.prepare(
  "UPDATE cards SET deck_id = ? WHERE user_id = ? AND deck_id IS NULL",
);
const findCardsForUser = database.prepare(
  "SELECT id, term, definition, mastered FROM cards WHERE user_id = ? AND deck_id = ? ORDER BY id",
);
const findCardForUser = database.prepare(
  "SELECT id, term, definition, mastered FROM cards WHERE id = ? AND user_id = ?",
);
const insertCard = database.prepare(
  `INSERT INTO cards (user_id, deck_id, term, definition, mastered, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
);

function ensureDefaultDeck(userId) {
  let deck = findFirstDeckForUser.get(userId);
  if (!deck) {
    insertDeck.run(userId, "My Flashcards", new Date().toISOString());
    deck = findFirstDeckForUser.get(userId);
  }
  updateUnassignedCards.run(deck.id, userId);
  return deck;
}

for (const { id } of database.prepare("SELECT id FROM users").all()) {
  ensureDefaultDeck(id);
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isGuest: Boolean(row.is_guest),
  };
}

function publicCard(row) {
  return {
    id: row.id,
    term: row.term,
    definition: row.definition,
    mastered: Boolean(row.mastered),
  };
}

function publicDeck(row) {
  return {
    id: row.id,
    name: row.name,
    cardCount: row.card_count ?? 0,
  };
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function readSessionToken(cookieHeader = "") {
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName}=`));

  if (!cookie) return null;
  const token = cookie.slice(sessionCookieName.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function writeSessionCookie(response, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionDurationMs / 1000}${secure}`,
  );
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = Date.now() + sessionDurationMs;

  database
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(tokenHash, userId, expiresAt);
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());

  return token;
}

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.use("/api", (request, response, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();

  const origin = request.get("origin");
  if (!origin) return next();

  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(`http://${request.get("host")}`);
    if (originUrl.host === requestUrl.host) return next();

    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    if (
      process.env.NODE_ENV !== "production" &&
      localHosts.has(originUrl.hostname) &&
      localHosts.has(requestUrl.hostname)
    ) {
      return next();
    }
  } catch {
    return response.status(403).json({ error: "Request origin is not allowed." });
  }
  return response.status(403).json({ error: "Request origin is not allowed." });
});
app.use((request, _response, next) => {
  const token = readSessionToken(request.headers.cookie);
  if (!token) {
    request.user = null;
    request.sessionTokenHash = null;
    return next();
  }

  const tokenHash = hashToken(token);
  const session = database
    .prepare(
      `SELECT users.id, users.email, users.display_name, users.is_guest, sessions.expires_at
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ?`,
    )
    .get(tokenHash);

  if (!session || session.expires_at <= Date.now()) {
    if (session) {
      database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    }
    request.user = null;
    request.sessionTokenHash = null;
    return next();
  }

  request.user = publicUser(session);
  request.sessionTokenHash = tokenHash;
  return next();
});

function requireUser(request, response, next) {
  if (!request.user) {
    return response.status(401).json({ error: "Please sign in to continue." });
  }
  return next();
}

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in a few minutes." },
});

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validateCard(value) {
  if (!value || typeof value !== "object") return null;
  const term = typeof value.term === "string" ? value.term.trim() : "";
  const definition =
    typeof value.definition === "string" ? value.definition.trim() : "";
  if (!term || term.length > 120 || !definition || definition.length > 1000) {
    return null;
  }
  return { term, definition, mastered: value.mastered === true };
}

function listCards(userId, deckId) {
  return findCardsForUser.all(userId, deckId).map(publicCard);
}

function listDecks(userId) {
  ensureDefaultDeck(userId);
  return listDecksForUser.all(userId).map(publicDeck);
}

function saveSessionForUser(userId, response) {
  const token = createSession(userId);
  writeSessionCookie(response, token);
}

app.get("/api/auth/me", (request, response) => {
  response.json({ user: request.user });
});

app.post("/api/auth/register", authRateLimit, async (request, response, next) => {
  try {
    const email = normalizeEmail(request.body?.email);
    const password = request.body?.password;
    const displayName =
      typeof request.body?.displayName === "string"
        ? request.body.displayName.trim()
        : "";

    if (!validEmail(email)) {
      return response.status(400).json({ error: "Enter a valid email address." });
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      return response
        .status(400)
        .json({ error: "Use a password between 8 and 128 characters." });
    }
    if (!displayName || displayName.length > 80) {
      return response
        .status(400)
        .json({ error: "Enter a name between 1 and 80 characters." });
    }
    if (request.user && !request.user.isGuest) {
      return response.status(409).json({ error: "An account is already signed in." });
    }

    const existing = database
      .prepare("SELECT id FROM users WHERE email = ? AND id != ?")
      .get(email, request.user?.id || "");
    if (existing) {
      return response.status(409).json({ error: "An account with this email already exists." });
    }

    const salt = randomBytes(16);
    const derivedKey = await scryptAsync(password, salt, passwordKeyLength, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });

    let userId = request.user?.id;
    if (request.user?.isGuest) {
      database
        .prepare(
          `UPDATE users
           SET email = ?, display_name = ?, password_salt = ?, password_hash = ?, is_guest = 0
           WHERE id = ? AND is_guest = 1`,
        )
        .run(
          email,
          displayName,
          salt.toString("hex"),
          Buffer.from(derivedKey).toString("hex"),
          userId,
        );
    } else {
      userId = randomUUID();
      database
        .prepare(
          `INSERT INTO users
           (id, email, display_name, password_salt, password_hash, is_guest, created_at)
           VALUES (?, ?, ?, ?, ?, 0, ?)`,
        )
        .run(
          userId,
          email,
          displayName,
          salt.toString("hex"),
          Buffer.from(derivedKey).toString("hex"),
          new Date().toISOString(),
        );
      ensureDefaultDeck(userId);
      saveSessionForUser(userId, response);
    }

    const user = findUserById.get(userId);
    return response.status(201).json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/auth/login", authRateLimit, async (request, response, next) => {
  try {
    const email = normalizeEmail(request.body?.email);
    const password =
      typeof request.body?.password === "string" ? request.body.password : "";
    const passwordLengthValid = password.length <= 128;
    const user = validEmail(email)
      ? database
          .prepare(
            `SELECT id, email, display_name, is_guest, password_salt, password_hash
             FROM users WHERE email = ?`,
          )
          .get(email)
      : null;

    const salt = user?.password_salt
      ? Buffer.from(user.password_salt, "hex")
      : dummySalt;
    const expectedHash = user?.password_hash
      ? Buffer.from(user.password_hash, "hex")
      : Buffer.alloc(passwordKeyLength);
    const actualHash = Buffer.from(
      await scryptAsync(password.slice(0, 128), salt, passwordKeyLength, {
        N: 16384,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      }),
    );
    const passwordMatches = timingSafeEqual(actualHash, expectedHash);

    if (
      !user ||
      user.is_guest ||
      !user.password_hash ||
      !passwordLengthValid ||
      !passwordMatches ||
      request.user
    ) {
      return response.status(401).json({ error: "Email or password is incorrect." });
    }

    saveSessionForUser(user.id, response);
    return response.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/auth/guest", authRateLimit, (request, response, next) => {
  try {
    if (request.user) {
      if (request.user.isGuest) return response.json({ user: request.user });
      return response.status(409).json({ error: "An account is already signed in." });
    }

    const userId = randomUUID();
    database
      .prepare(
        `INSERT INTO users (id, email, display_name, is_guest, created_at)
         VALUES (?, NULL, 'Guest', 1, ?)`,
      )
      .run(userId, new Date().toISOString());
    ensureDefaultDeck(userId);
    saveSessionForUser(userId, response);

    return response.status(201).json({
      user: publicUser(findUserById.get(userId)),
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/auth/logout", requireUser, (request, response) => {
  if (request.sessionTokenHash) {
    database
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .run(request.sessionTokenHash);
  }
  clearSessionCookie(response);
  return response.json({ success: true });
});

app.get("/api/decks", requireUser, (request, response) => {
  response.json({ decks: listDecks(request.user.id) });
});

app.post("/api/decks", requireUser, (request, response) => {
  const name =
    typeof request.body?.name === "string" ? request.body.name.trim() : "";
  if (!name || name.length > 60) {
    return response.status(400).json({ error: "Enter a deck name up to 60 characters." });
  }
  if (countDecksForUser.get(request.user.id).count >= 5) {
    return response.status(409).json({ error: "You can create up to 5 decks." });
  }
  const existing = database
    .prepare("SELECT id FROM decks WHERE user_id = ? AND name = ?")
    .get(request.user.id, name);
  if (existing) {
    return response.status(409).json({ error: "A deck with that name already exists." });
  }

  const result = insertDeck.run(request.user.id, name, new Date().toISOString());
  const deck = listDecksForUser
    .all(request.user.id)
    .find((item) => item.id === Number(result.lastInsertRowid));
  return response.status(201).json({ deck: publicDeck(deck) });
});

app.get("/api/cards", requireUser, (request, response) => {
  const deckId = Number(request.query.deckId);
  if (!Number.isSafeInteger(deckId) || deckId < 1) {
    return response.status(400).json({ error: "Choose a valid deck." });
  }
  if (!findDeckForUser.get(deckId, request.user.id)) {
    return response.status(404).json({ error: "Deck not found." });
  }
  response.json({ cards: listCards(request.user.id, deckId) });
});

app.post("/api/cards", requireUser, (request, response, next) => {
  try {
    const card = validateCard(request.body);
    if (!card) {
      return response.status(400).json({
        error: "Enter a term (up to 120 characters) and definition (up to 1,000 characters).",
      });
    }
    const deckId = Number(request.body?.deckId);
    if (!Number.isSafeInteger(deckId) || deckId < 1) {
      return response.status(400).json({ error: "Choose a valid deck." });
    }
    if (!findDeckForUser.get(deckId, request.user.id)) {
      return response.status(404).json({ error: "Deck not found." });
    }

    const result = insertCard.run(
      request.user.id,
      deckId,
      card.term,
      card.definition,
      Number(card.mastered),
      new Date().toISOString(),
    );
    const savedCard = findCardForUser.get(result.lastInsertRowid, request.user.id);
    return response.status(201).json({ card: publicCard(savedCard) });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/cards/import", requireUser, (request, response, next) => {
  try {
    if (!request.user.isGuest) {
      return response.status(403).json({ error: "Local card import is available in guest mode." });
    }
    const cards = request.body?.cards;
    if (!Array.isArray(cards) || cards.length > 500) {
      return response.status(400).json({ error: "The card import must contain at most 500 cards." });
    }

    const validatedCards = cards.map(validateCard);
    if (validatedCards.some((card) => !card)) {
      return response.status(400).json({ error: "One or more saved cards are invalid." });
    }
    const defaultDeck = findFirstDeckForUser.get(request.user.id);
    const deckId =
      request.body?.deckId === undefined
        ? defaultDeck?.id
        : Number(request.body.deckId);
    if (!Number.isSafeInteger(deckId) || deckId < 1) {
      return response.status(400).json({ error: "Choose a valid deck." });
    }
    if (!findDeckForUser.get(deckId, request.user.id)) {
      return response.status(404).json({ error: "Deck not found." });
    }
    const existingCards = database
      .prepare("SELECT COUNT(*) AS count FROM cards WHERE user_id = ?")
      .get(request.user.id).count;
    if (existingCards) {
      return response.status(409).json({ error: "This guest account already has cards." });
    }

    const importCards = database.transaction((items) => {
      for (const card of items) {
        insertCard.run(
          request.user.id,
          deckId,
          card.term,
          card.definition,
          Number(card.mastered),
          new Date().toISOString(),
        );
      }
    });
    importCards(validatedCards);
    return response.status(201).json({ cards: listCards(request.user.id, deckId) });
  } catch (error) {
    return next(error);
  }
});

app.patch("/api/cards/:id", requireUser, (request, response) => {
  const id = Number(request.params.id);
  const { mastered } = request.body || {};
  if (!Number.isSafeInteger(id) || id < 1 || typeof mastered !== "boolean") {
    return response.status(400).json({ error: "The card update is invalid." });
  }

  const result = database
    .prepare("UPDATE cards SET mastered = ? WHERE id = ? AND user_id = ?")
    .run(Number(mastered), id, request.user.id);
  if (!result.changes) {
    return response.status(404).json({ error: "Card not found." });
  }

  return response.json({
    card: publicCard(findCardForUser.get(id, request.user.id)),
  });
});

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "API route not found." });
});

const clientDirectory = path.join(projectDirectory, "dist");
if (existsSync(path.join(clientDirectory, "index.html"))) {
  app.use(express.static(clientDirectory));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(clientDirectory, "index.html"));
  });
}

app.use((error, _request, response, _next) => {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error(error);
  const message =
    status >= 500
      ? "The server could not complete the request."
      : status === 413
        ? "The request is too large."
        : "The request could not be processed.";
  response.status(status).json({ error: message });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Flashcards server listening on http://127.0.0.1:${port}`);
});
