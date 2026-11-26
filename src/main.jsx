import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const CARDS_STORAGE_KEY = "flashcard-generator-cards";

async function apiRequest(url, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Unable to reach the server. Check that the app is running.");
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The server returned an invalid response.");
  }
  if (!response.ok) throw new Error(result.error || "The request could not be completed.");
  return result;
}

async function loadCardsForUser(user, deckId) {
  const response = await apiRequest(`/api/cards?deckId=${encodeURIComponent(deckId)}`);
  if (!user.isGuest || response.cards.length) return response.cards;

  const savedCards = window.localStorage.getItem(CARDS_STORAGE_KEY);
  if (!savedCards) return response.cards;

  let legacyCards;
  try {
    legacyCards = JSON.parse(savedCards);
  } catch {
    throw new Error("Saved browser cards could not be imported.");
  }
  if (!Array.isArray(legacyCards)) {
    throw new Error("Saved browser cards could not be imported.");
  }
  if (!legacyCards.length) {
    window.localStorage.removeItem(CARDS_STORAGE_KEY);
    return response.cards;
  }

  const imported = await apiRequest("/api/cards/import", {
    method: "POST",
    body: { cards: legacyCards, deckId },
  });
  window.localStorage.removeItem(CARDS_STORAGE_KEY);
  return imported.cards;
}

async function loadWorkspace(user) {
  const { decks } = await apiRequest("/api/decks");
  const activeDeck = decks[0];
  if (!activeDeck) throw new Error("A study deck could not be loaded.");
  const cards = await loadCardsForUser(user, activeDeck.id);
  return {
    decks: decks.map((deck) =>
      deck.id === activeDeck.id ? { ...deck, cardCount: cards.length } : deck,
    ),
    activeDeck,
    cards,
  };
}

function Icon({ name, size = 16, className = "" }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
    "aria-hidden": true,
  };

  const shapes = {
    sparkle: (
      <>
        <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
        <path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" />
      </>
    ),
    chevronDown: <path d="m7 10 5 5 5-5" />,
    book: (
      <>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 1 4 16.5v-11Z" />
        <path d="M4 16.5A2.5 2.5 0 0 1 6.5 14H20M9 7h7" />
      </>
    ),
    list: (
      <>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <path d="M4 6h.01M4 12h.01M4 18h.01" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5Z" />
        <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    shuffle: (
      <>
        <path d="m18 14 4 4-4 4" />
        <path d="M2 18h2.5a6 6 0 0 0 4.2-1.7L17 8a6 6 0 0 1 4.2-1.7H22" />
        <path d="m18 2 4 4-4 4" />
        <path d="M2 6h2.5a6 6 0 0 1 3.7 1.3M14 16.7a6 6 0 0 0 3 1.3h1" />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12 2.2 2.2 4.8-4.8" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.6 9a2.5 2.5 0 1 1 4.7 1.2c-.8 1.1-2.3 1.4-2.3 3" />
        <path d="M12 17h.01" />
      </>
    ),
    rotate: (
      <>
        <path d="M20 7v5h-5" />
        <path d="M20 12a8 8 0 1 0 2 5" />
      </>
    ),
    speaker: (
      <>
        <path d="M4 10v4h4l5 4V6l-5 4H4Z" />
        <path d="M17 9a5 5 0 0 1 0 6M19.5 6.5a9 9 0 0 1 0 11" />
      </>
    ),
    arrowLeft: (
      <>
        <path d="m14 18-6-6 6-6" />
      </>
    ),
    arrowRight: (
      <>
        <path d="m10 18 6-6-6-6" />
      </>
    ),
    remix: (
      <>
        <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
      </>
    ),
    device: (
      <>
        <rect x="3" y="4" width="13" height="13" rx="1.5" />
        <path d="M7 21h14V8h-2M9 17v4" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2" />
      </>
    ),
    expand: (
      <>
        <path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" />
        <path d="m3 3 6 6m12-6-6 6M3 21l6-6m12 6-6-6" />
      </>
    ),
    close: <path d="m18 6-12 12M6 6l12 12" />,
  };

  return <svg {...common}>{shapes[name]}</svg>;
}

function CardFace({ card, isBack }) {
  const text = isBack ? card?.definition : card?.term;

  return (
    <span
      className={`card-face${isBack ? " card-face-back" : ""}`}
      aria-hidden={isBack}
    >
      <span className="card-topline">
        <span className="card-side-label">
          {isBack ? "BACK · DEFINITION" : "FRONT · KEY TERM"}
        </span>
        <span className="card-top-actions">
          {card?.mastered && (
            <span className="mastered-pill">
              <Icon name="check" size={12} />
              Mastered
            </span>
          )}
          <span
            className="card-sound"
            role="button"
            aria-label={`Hear card ${isBack ? "definition" : "term"}`}
            onClick={(event) => {
              event.stopPropagation();
              if (text && "speechSynthesis" in window) {
                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
              }
            }}
          >
            <Icon name="speaker" size={15} />
          </span>
        </span>
      </span>
      <span className="card-content">
        <span className="card-text">{text}</span>
      </span>
      <span className="card-footer">
        <span className="card-hint">
          <Icon name="rotate" size={14} />
          {isBack
            ? "Click or press Space to see key term"
            : "Click or press Space to reveal definition"}
        </span>
        <span className="card-shortcut">Space / Click to Flip</span>
      </span>
    </span>
  );
}

function AuthPage({
  mode,
  onModeChange,
  onSubmit,
  onGuest,
  error,
  busy,
  guestAvailable,
  onCancel,
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const isRegistering = mode === "register";

  return (
    <div className="app-shell auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="brand-mark auth-brand-mark">
          <Icon name="sparkle" size={20} />
        </div>
        <p className="auth-eyebrow">PDF FLASHCARDS</p>
        <h1 id="auth-title">
          {onCancel
            ? "Keep your cards safe"
            : isRegistering
              ? "Create your account"
              : "Welcome back"}
        </h1>
        <p className="auth-intro">
          {onCancel
            ? "Add an email and password to keep your guest cards when you sign in on another device."
            : isRegistering
              ? "Create an account to access your study cards whenever you sign in."
              : "Sign in to continue studying, or use guest mode to get started."}
        </p>

        <form
          className="auth-form"
          onSubmit={(event) =>
            onSubmit(event, { displayName, email, password })
          }
        >
          {isRegistering && (
            <label>
              Name
              <input
                autoComplete="name"
                maxLength={80}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                value={displayName}
              />
            </label>
          )}
          <label>
            Email
            <input
              autoComplete="email"
              autoFocus={!isRegistering}
              maxLength={254}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Password
            <input
              autoComplete={isRegistering ? "new-password" : "current-password"}
              minLength={8}
              maxLength={128}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
            {isRegistering && (
              <small className="field-note">Use at least 8 characters.</small>
            )}
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-primary" disabled={busy} type="submit">
            {busy
              ? "Please wait..."
              : onCancel
                ? "Create account"
                : isRegistering
                  ? "Create account"
                  : "Sign in"}
          </button>
        </form>

        {guestAvailable && (
          <>
            <div className="auth-divider"><span>or</span></div>
            <button
              className="auth-guest"
              disabled={busy}
              onClick={onGuest}
              type="button"
            >
              Continue as guest
            </button>
            <p className="guest-note">
              Guest cards stay linked to this browser. Existing browser cards
              are imported, and you can create an account later for access on
              other devices.
            </p>
          </>
        )}

        <div className="auth-footer">
          {onCancel ? (
            <button className="auth-text-button" onClick={onCancel} type="button">
              Back to guest mode
            </button>
          ) : isRegistering ? (
            <span>
              Already have an account?{" "}
              <button
                className="auth-text-button"
                onClick={() => onModeChange("login")}
                type="button"
              >
                Sign in
              </button>
            </span>
          ) : (
            <span>
              New here?{" "}
              <button
                className="auth-text-button"
                onClick={() => onModeChange("register")}
                type="button"
              >
                Create an account
              </button>
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

function App() {
  const [cards, setCards] = useState([]);
  const [decks, setDecks] = useState([]);
  const [activeDeckId, setActiveDeckId] = useState(null);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState("login");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [appError, setAppError] = useState("");
  const [currentId, setCurrentId] = useState(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const [filter, setFilter] = useState("all");
  const [activeView, setActiveView] = useState("dashboard");
  const [dialog, setDialog] = useState("");
  const [subjectOpen, setSubjectOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(
    () => window.localStorage.getItem("flashcard-welcome-seen") !== "true",
  );
  const [newTerm, setNewTerm] = useState("");
  const [newDefinition, setNewDefinition] = useState("");
  const [formError, setFormError] = useState("");
  const [newDeckName, setNewDeckName] = useState("");
  const [deckFormError, setDeckFormError] = useState("");
  const [deckBusy, setDeckBusy] = useState(false);
  const deckLoadRequest = useRef(0);
  const activeDeck = decks.find((deck) => deck.id === activeDeckId);

  const masteredCount = cards.filter((card) => card.mastered).length;
  const reviewCount = cards.length - masteredCount;
  const visibleCards = useMemo(
    () =>
      filter === "review" ? cards.filter((card) => !card.mastered) : cards,
    [cards, filter],
  );
  const currentIndex = visibleCards.findIndex((card) => card.id === currentId);
  const safeIndex = currentIndex < 0 ? 0 : currentIndex;
  const card = visibleCards[safeIndex] ?? cards[0];

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      let sessionUser = null;
      try {
        const response = await apiRequest("/api/auth/me");
        sessionUser = response.user;
        if (!active) return;
        setUser(sessionUser);
        if (sessionUser) {
          const workspace = await loadWorkspace(sessionUser);
          if (active) {
            setDecks(workspace.decks);
            setActiveDeckId(workspace.activeDeck.id);
            setCards(workspace.cards);
          }
        }
      } catch (error) {
        if (!active) return;
        if (sessionUser) {
          setAppError(error.message);
        } else {
          setAuthError(error.message);
        }
      } finally {
        if (active) setAuthLoading(false);
      }
    }

    restoreSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!visibleCards.length) {
      setCurrentId(null);
      setIsFlipped(false);
    } else if (!visibleCards.some((item) => item.id === currentId)) {
      setCurrentId(visibleCards[0]?.id ?? cards[0]?.id);
      setIsFlipped(false);
    }
  }, [cards, currentId, visibleCards]);

  const moveCard = useCallback(
    (direction) => {
      if (!visibleCards.length) return;
      const index = visibleCards.findIndex((item) => item.id === currentId);
      const start = index < 0 ? 0 : index;
      const next = (start + direction + visibleCards.length) % visibleCards.length;
      setCurrentId(visibleCards[next].id);
      setIsFlipped(false);
    },
    [currentId, visibleCards],
  );

  const toggleMastered = useCallback(async () => {
    if (!card) return;
    setAppError("");
    try {
      const { card: updatedCard } = await apiRequest(`/api/cards/${card.id}`, {
        method: "PATCH",
        body: { mastered: !card.mastered },
      });
      setCards((items) =>
        items.map((item) => (item.id === updatedCard.id ? updatedCard : item)),
      );
    } catch (error) {
      setAppError(error.message);
    }
  }, [card]);

  useEffect(() => {
    function onKeyDown(event) {
      if (
        event.target instanceof HTMLInputElement ||
        dialog ||
        showWelcome ||
        !cards.length
      ) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        setIsFlipped((flipped) => !flipped);
      } else if (event.key === "ArrowRight") {
        moveCard(1);
      } else if (event.key === "ArrowLeft") {
        moveCard(-1);
      } else if (event.key.toLowerCase() === "m") {
        toggleMastered();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cards.length, dialog, moveCard, showWelcome, toggleMastered]);

  function shuffleCards() {
    if (visibleCards.length < 2) return;
    const shuffled = [...visibleCards];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [
        shuffled[swapIndex],
        shuffled[index],
      ];
    }
    const shuffledIds = new Set(shuffled.map((item) => item.id));
    const remaining = cards.filter((item) => !shuffledIds.has(item.id));
    setCards([...shuffled, ...remaining]);
    const current = shuffled[0];
    setCurrentId(current.id);
    setIsFlipped(false);
  }

  function handleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }

  async function handleAuthSubmit(event, credentials) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError("");

    try {
      const endpoint =
        authMode === "register" ? "/api/auth/register" : "/api/auth/login";
      const response = await apiRequest(endpoint, {
        method: "POST",
        body: credentials,
      });
      setUser(response.user);
      setShowAccountForm(false);
      setAppError("");

      try {
        const workspace = await loadWorkspace(response.user);
        setDecks(workspace.decks);
        setActiveDeckId(workspace.activeDeck.id);
        setCards(workspace.cards);
      } catch (error) {
        setAppError(error.message);
      }
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleGuestSignIn() {
    setAuthBusy(true);
    setAuthError("");
    let hasGuestSession = false;

    try {
      const response = await apiRequest("/api/auth/guest", { method: "POST" });
      hasGuestSession = true;
      setUser(response.user);
      setShowAccountForm(false);
      const workspace = await loadWorkspace(response.user);
      setDecks(workspace.decks);
      setActiveDeckId(workspace.activeDeck.id);
      setCards(workspace.cards);
      setAppError("");
    } catch (error) {
      if (hasGuestSession) {
        setAppError(error.message);
      } else {
        setAuthError(error.message);
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
      deckLoadRequest.current += 1;
      setUser(null);
      setCards([]);
      setDecks([]);
      setActiveDeckId(null);
      setAuthMode("login");
      setShowAccountForm(false);
      setAuthError("");
      setAppError("");
    } catch (error) {
      setAppError(error.message);
    }
  }

  function openAccountForm() {
    setAuthMode("register");
    setAuthError("");
    setShowAccountForm(true);
  }

  function closeDialog() {
    setDialog("");
    setActiveView("dashboard");
  }

  async function selectDeck(deck) {
    const requestId = ++deckLoadRequest.current;
    setSubjectOpen(false);
    setActiveDeckId(deck.id);
    setFilter("all");
    setCurrentId(null);
    setCards([]);
    setIsFlipped(false);
    setAppError("");
    try {
      const { cards: deckCards } = await apiRequest(
        `/api/cards?deckId=${encodeURIComponent(deck.id)}`,
      );
      if (requestId !== deckLoadRequest.current) return;
      setCards(deckCards);
      setDecks((items) =>
        items.map((item) =>
          item.id === deck.id ? { ...item, cardCount: deckCards.length } : item,
        ),
      );
    } catch (error) {
      if (requestId === deckLoadRequest.current) setAppError(error.message);
    }
  }

  function openNewDeckDialog() {
    setNewDeckName("");
    setDeckFormError("");
    setDialog("new-deck");
    setSubjectOpen(false);
  }

  async function addDeck(event) {
    event.preventDefault();
    const name = newDeckName.trim();
    if (!name) {
      setDeckFormError("Enter a name for your deck.");
      return;
    }
    if (decks.length >= 5) {
      setDeckFormError("You can create up to 5 decks.");
      return;
    }

    setDeckBusy(true);
    setDeckFormError("");
    try {
      const { deck } = await apiRequest("/api/decks", {
        method: "POST",
        body: { name },
      });
      deckLoadRequest.current += 1;
      setDecks((items) => [...items, deck]);
      setActiveDeckId(deck.id);
      setCards([]);
      setCurrentId(null);
      setFilter("all");
      setIsFlipped(false);
      setNewDeckName("");
      setDialog("");
      setActiveView("dashboard");
    } catch (error) {
      setDeckFormError(error.message);
    } finally {
      setDeckBusy(false);
    }
  }

  function finishWelcome(createCard = false) {
    window.localStorage.setItem("flashcard-welcome-seen", "true");
    setShowWelcome(false);
    if (createCard) openNewCardDialog();
  }

  function openNewCardDialog() {
    setNewTerm("");
    setNewDefinition("");
    setFormError("");
    setDialog("new");
  }

  async function addCard(event) {
    event.preventDefault();
    const term = newTerm.trim();
    const definition = newDefinition.trim();
    if (!term || !definition) {
      setFormError("Add both a term and its definition.");
      return;
    }

    setFormError("");
    setAppError("");
    try {
      const { card: newCard } = await apiRequest("/api/cards", {
        method: "POST",
        body: { term, definition, deckId: activeDeckId },
      });
      setCards((items) => [...items, newCard]);
      setDecks((items) =>
        items.map((deck) =>
          deck.id === activeDeckId
            ? { ...deck, cardCount: deck.cardCount + 1 }
            : deck,
        ),
      );
      setCurrentId(newCard.id);
      setFilter("all");
      setIsFlipped(false);
      setNewTerm("");
      setNewDefinition("");
      closeDialog();
    } catch (error) {
      setFormError(error.message);
    }
  }

  const progress = cards.length ? (safeIndex + 1) / cards.length : 0;
  const masteryPercent = cards.length
    ? Math.round((masteredCount / cards.length) * 100)
    : 0;
  const dashboardName = user?.displayName || "Learner";

  if (authLoading) {
    return (
      <div className="app-shell auth-shell">
        <p className="auth-loading">Loading your study space...</p>
      </div>
    );
  }

  if (!user || showAccountForm) {
    return (
      <AuthPage
        mode={authMode}
        onModeChange={(mode) => {
          setAuthMode(mode);
          setAuthError("");
        }}
        onSubmit={handleAuthSubmit}
        onGuest={handleGuestSignIn}
        error={authError}
        busy={authBusy}
        guestAvailable={!user}
        onCancel={user ? () => setShowAccountForm(false) : null}
      />
    );
  }

  return (
    <div className="app-shell">
      <div className="workspace-toolbar">
        <span className="toolbar-title">Flashcard Generator</span>
        <div className="toolbar-actions">
          <button className="toolbar-remix" onClick={shuffleCards}>
            <Icon name="remix" size={14} />
            <span>Remix</span>
          </button>
          <button
            className="toolbar-link"
            onClick={() => setDialog("device")}
            aria-label="Device options"
          >
            <Icon name="device" size={14} />
            <span>Device</span>
          </button>
          <button
            className="icon-button toolbar-icon"
            onClick={() => {
              setIsFlipped(false);
              setCurrentId(visibleCards[0]?.id ?? cards[0]?.id);
            }}
            aria-label="Restart study session"
          >
            <Icon name="refresh" size={15} />
          </button>
          <button
            className="icon-button toolbar-icon"
            onClick={handleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            <Icon name="expand" size={15} />
          </button>
          <div className="account-control">
            <span className="account-name">
              {user.isGuest ? "Guest mode" : user.displayName}
            </span>
            <button
              className="account-action"
              onClick={user.isGuest ? openAccountForm : handleLogout}
            >
              {user.isGuest ? "Create account" : "Sign out"}
            </button>
          </div>
        </div>
      </div>

      <header className="app-header">
        <div className="brand-group">
          <div className="brand-mark">
            <Icon name="sparkle" size={20} />
          </div>
          <div className="brand-copy">
            <strong>PDF Flashcards</strong>
            <span>Note to Deck AI</span>
          </div>
          <div className="subject-wrap">
            <button
              className="subject-select"
              onClick={() => setSubjectOpen((open) => !open)}
              aria-expanded={subjectOpen}
            >
              <span>{activeDeck?.name || "My Flashcards"}</span>
              <Icon name="chevronDown" size={14} />
            </button>
            {subjectOpen && (
              <div className="subject-menu">
                {decks.map((deck) => (
                  <button
                    className="subject-deck-option"
                    key={deck.id}
                    onClick={() => selectDeck(deck)}
                  >
                    <span>{deck.name}</span>
                    <span className="subject-deck-meta">
                      {deck.cardCount}
                      {deck.id === activeDeckId && <Icon name="check" size={14} />}
                    </span>
                  </button>
                ))}
                <div className="subject-menu-divider" />
                <button
                  onClick={() => {
                    setSubjectOpen(false);
                    setDialog("decks");
                  }}
                >
                  Manage decks ({decks.length}/5)
                </button>
                <button
                  disabled={decks.length >= 5}
                  onClick={openNewDeckDialog}
                >
                  <span><Icon name="plus" size={14} /> Add a deck</span>
                  {decks.length >= 5 && <small>Limit reached</small>}
                </button>
              </div>
            )}
          </div>
        </div>

        <nav className="main-nav" aria-label="Main navigation">
          <div className="view-tabs">
            <button
              className={
                activeView === "dashboard" ? "view-tab active" : "view-tab"
              }
              onClick={() => setActiveView("dashboard")}
            >
              <Icon name="sparkle" size={15} />
              {dashboardName}
            </button>
            <button
              className={activeView === "study" ? "view-tab active" : "view-tab"}
              onClick={() => setActiveView("study")}
            >
              <Icon name="book" size={15} />
              Study
            </button>
            <button
              className={
                activeView === "list" ? "view-tab active" : "view-tab"
              }
              onClick={() => {
                setActiveView("list");
                setDialog("list");
              }}
            >
              <Icon name="list" size={15} />
              Card List
            </button>
            <button
              className={
                activeView === "decks" ? "view-tab active" : "view-tab"
              }
              onClick={() => {
                setActiveView("decks");
                setDialog("decks");
              }}
            >
              <Icon name="layers" size={15} />
              Decks <span className="deck-count">({decks.length}/5)</span>
            </button>
          </div>
          <button
            className="new-button"
            onClick={openNewCardDialog}
          >
            <Icon name="plus" size={16} />
            New
          </button>
        </nav>
      </header>

      {appError && (
        <div className="app-alert" role="alert">
          <span>{appError}</span>
          <button onClick={() => setAppError("")}>Dismiss</button>
        </div>
      )}

      <main
        className={`study-area${activeView === "dashboard" ? " dashboard-area" : ""}`}
      >
        {activeView === "dashboard" ? (
          <section className="learning-dashboard" aria-labelledby="dashboard-title">
            <div className="dashboard-heading">
              <div>
                <p className="dashboard-eyebrow">STUDENT DASHBOARD</p>
                <h1 id="dashboard-title">{dashboardName}</h1>
                <p>Learning progress, all in one place.</p>
              </div>
              <span className="dashboard-tag">
                <Icon name="book" size={15} />
                Learning
              </span>
            </div>

            <div className="dashboard-stats">
              <article className="dashboard-stat">
                <span>Flashcards</span>
                <strong>{cards.length}</strong>
                <small>In your study deck</small>
              </article>
              <article className="dashboard-stat">
                <span>Mastered</span>
                <strong>{masteredCount}</strong>
                <small>Ready to recall</small>
              </article>
              <article className="dashboard-stat">
                <span>Needs review</span>
                <strong>{reviewCount}</strong>
                <small>Worth another look</small>
              </article>
            </div>

            <div className="dashboard-panels">
              <section className="dashboard-panel mastery-panel">
                <div className="panel-heading">
                  <div>
                    <span className="panel-kicker">YOUR PROGRESS</span>
                    <h2>Mastery progress</h2>
                  </div>
                  <strong className="mastery-percent">{masteryPercent}%</strong>
                </div>
                <div
                  className="dashboard-progress"
                  role="progressbar"
                  aria-label="Mastery progress"
                  aria-valuenow={masteryPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span style={{ width: `${masteryPercent}%` }} />
                </div>
                <p>
                  {cards.length
                    ? `${masteredCount} of ${cards.length} cards mastered`
                    : "Create flashcards to see your learning progress here."}
                </p>
              </section>

              <section className="dashboard-panel next-step-panel">
                <span className="panel-kicker">NEXT STEP</span>
                <h2>
                  {cards.length
                    ? reviewCount
                      ? "Strengthen your recall"
                      : "Keep your momentum"
                    : "Start with one idea"}
                </h2>
                <p>
                  {cards.length
                    ? reviewCount
                      ? `${reviewCount} ${reviewCount === 1 ? "card is" : "cards are"} ready for review.`
                      : "Your cards are mastered. Add more to keep learning."
                    : "Turn a key term and definition from your notes into a flashcard."}
                </p>
                <div className="dashboard-actions">
                  {cards.length ? (
                    <>
                      <button
                        className="dashboard-primary"
                        onClick={() => setActiveView("study")}
                      >
                        <Icon name="book" size={15} />
                        Study cards
                      </button>
                      <button
                        className="dashboard-secondary"
                        disabled={!reviewCount}
                        onClick={() => {
                          setFilter("review");
                          setActiveView("study");
                        }}
                      >
                        Review cards
                      </button>
                    </>
                  ) : (
                    <button
                      className="dashboard-primary"
                      onClick={openNewCardDialog}
                    >
                      <Icon name="plus" size={15} />
                      Create your first card
                    </button>
                  )}
                </div>
              </section>
            </div>
          </section>
        ) : cards.length ? (
          <>
            <section className="study-toolbar" aria-label="Card filters and progress">
              <div className="filter-group">
                <button
                  className={filter === "all" ? "filter-tab selected" : "filter-tab"}
                  onClick={() => setFilter("all")}
                >
                  All Cards ({cards.length})
                </button>
                <button
                  className={
                    filter === "review" ? "filter-tab selected" : "filter-tab"
                  }
                  onClick={() => setFilter("review")}
                >
                  Needs Review ({reviewCount})
                </button>
              </div>
              <button
                className="icon-button shuffle-button"
                onClick={shuffleCards}
                aria-label="Shuffle cards"
                title="Shuffle cards"
              >
                <Icon name="shuffle" size={16} />
              </button>
              <div className="study-status">
                <span className="card-position">
                  {visibleCards.length ? safeIndex + 1 : 0} of {cards.length}
                </span>
                <span className="mastery-summary">
                  <Icon name="check" size={12} />
                  {masteredCount}/{cards.length} mastered
                </span>
              </div>
            </section>

            <div
              className="progress-track"
              role="progressbar"
              aria-label="Study progress"
              aria-valuenow={safeIndex + 1}
              aria-valuemin={1}
              aria-valuemax={cards.length}
            >
              <span style={{ width: `${progress * 100}%` }} />
            </div>

            <button
              className={`flashcard${isFlipped ? " is-flipped" : ""}`}
              onClick={() => setIsFlipped((flipped) => !flipped)}
              aria-label={isFlipped ? "Show card term" : "Reveal card definition"}
            >
              <span className="card-inner">
                <CardFace card={card} isBack={false} />
                <CardFace card={card} isBack />
              </span>
            </button>

            <div className="study-controls">
              <button
                className="previous-button"
                onClick={() => moveCard(-1)}
                disabled={safeIndex === 0 || visibleCards.length < 2}
              >
                <Icon name="arrowLeft" size={15} />
                Previous
              </button>
              <div className="center-controls">
                <button
                  className="review-button"
                  onClick={() => {
                    if (card?.mastered) toggleMastered();
                    moveCard(1);
                  }}
                >
                  <Icon name="help" size={16} />
                  Review
                </button>
                <button
                  className="flip-button"
                  onClick={() => setIsFlipped((flipped) => !flipped)}
                >
                  <Icon name="rotate" size={15} />
                  Flip Card
                </button>
                <button
                  className={`mastered-button${card?.mastered ? " is-mastered" : ""}`}
                  onClick={() => {
                    if (!card?.mastered) toggleMastered();
                    moveCard(1);
                  }}
                >
                  <Icon name="check" size={15} />
                  Mastered
                </button>
              </div>
              <button
                className="next-button"
                onClick={() => moveCard(1)}
                disabled={visibleCards.length < 2}
              >
                Next
                <Icon name="arrowRight" size={15} />
              </button>
            </div>
            <div className="keyboard-hints" aria-label="Keyboard shortcuts">
              <span><kbd>Space</kbd> Flip Card</span>
              <span><kbd>←</kbd><kbd>→</kbd> Navigate</span>
              <span><kbd>M</kbd> Toggle Mastery</span>
            </div>
          </>
        ) : (
          <section className="empty-study" aria-labelledby="empty-study-title">
            <span className="empty-study-icon">
              <Icon name="layers" size={22} />
            </span>
            <h1 id="empty-study-title">Your study deck starts here</h1>
            <p>
              Add a term and definition to make your first flashcard. Then flip,
              review, and track your progress as you study.
            </p>
            <button className="empty-study-button" onClick={openNewCardDialog}>
              <Icon name="plus" size={16} />
              Create your first card
            </button>
          </section>
        )}
      </main>

      {dialog && (
        <div className="dialog-backdrop" onMouseDown={closeDialog}>
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <h2 id="dialog-title">
                {dialog === "list"
                  ? "Card List"
                  : dialog === "decks"
                    ? "Your Decks"
                    : dialog === "new-deck"
                      ? "Create a deck"
                      : dialog === "device"
                        ? "Study on any device"
                        : "Add a flashcard"}
              </h2>
              <button
                className="icon-button"
                onClick={closeDialog}
                aria-label="Close dialog"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            {dialog === "list" ? (
              cards.length ? (
                <div className="dialog-card-list">
                  {cards.map((item, index) => (
                  <button
                    className="dialog-card-row"
                    key={item.id}
                    onClick={() => {
                      setFilter("all");
                      setCurrentId(item.id);
                      setIsFlipped(false);
                      setActiveView("study");
                      setDialog("");
                    }}
                  >
                    <span className="row-number">{index + 1}</span>
                    <span className="row-term">{item.term}</span>
                    {item.mastered && (
                      <span className="row-mastered">Mastered</span>
                    )}
                  </button>
                  ))}
                </div>
              ) : (
                <div className="dialog-empty">
                  <p>Your cards will appear here after you create one.</p>
                  <button
                    className="dialog-primary"
                    onClick={openNewCardDialog}
                  >
                    <Icon name="plus" size={15} />
                    Add your first card
                  </button>
                </div>
              )
            ) : dialog === "decks" ? (
              <div className="deck-manager">
                <p className="dialog-copy">
                  Keep subjects organized in separate decks. You can have up to 5.
                </p>
                <div className="deck-list">
                  {decks.map((deck) => (
                    <button
                      className={`deck-row${deck.id === activeDeckId ? " selected" : ""}`}
                      key={deck.id}
                      onClick={() => {
                        setDialog("");
                        selectDeck(deck);
                      }}
                    >
                      <span className="deck-icon"><Icon name="layers" size={18} /></span>
                      <span>
                        <strong>{deck.name}</strong>
                        <small>{deck.cardCount} {deck.cardCount === 1 ? "card" : "cards"}</small>
                      </span>
                      {deck.id === activeDeckId
                        ? <Icon name="check" size={16} />
                        : <Icon name="arrowRight" size={16} />}
                    </button>
                  ))}
                </div>
                <div className="deck-manager-footer">
                  <span>{decks.length} of 5 decks</span>
                  <button
                    className="dialog-primary"
                    disabled={decks.length >= 5}
                    onClick={openNewDeckDialog}
                  >
                    <Icon name="plus" size={15} />
                    Add a deck
                  </button>
                </div>
                {decks.length >= 5 && (
                  <p className="deck-limit-note">You’ve reached the 5-deck limit.</p>
                )}
              </div>
            ) : dialog === "device" ? (
              <p className="dialog-copy">
                The study view adapts to desktop, tablet, and mobile screens.
              </p>
            ) : dialog === "new-deck" ? (
              <form className="card-form" onSubmit={addDeck}>
                <p className="dialog-copy">
                  Create a deck for another subject or topic. {5 - decks.length} {5 - decks.length === 1 ? "slot" : "slots"} left.
                </p>
                <label>
                  Deck name
                  <input
                    autoFocus
                    maxLength={60}
                    onChange={(event) => {
                      setNewDeckName(event.target.value);
                      setDeckFormError("");
                    }}
                    required
                    value={newDeckName}
                  />
                </label>
                {deckFormError && (
                  <p className="form-error" role="alert">{deckFormError}</p>
                )}
                <button
                  className="dialog-primary"
                  disabled={deckBusy || decks.length >= 5}
                  type="submit"
                >
                  <Icon name="plus" size={15} />
                  {deckBusy ? "Creating..." : "Create deck"}
                </button>
              </form>
            ) : (
              <form className="card-form" onSubmit={addCard}>
                <label>
                  Term
                  <input
                    autoFocus
                    maxLength={120}
                    onChange={(event) => {
                      setNewTerm(event.target.value);
                      setFormError("");
                    }}
                    required
                    value={newTerm}
                  />
                </label>
                <label>
                  Definition
                  <textarea
                    maxLength={1000}
                    onChange={(event) => {
                      setNewDefinition(event.target.value);
                      setFormError("");
                    }}
                    required
                    rows={4}
                    value={newDefinition}
                  />
                </label>
                {formError && (
                  <p className="form-error" role="alert">{formError}</p>
                )}
                <button className="dialog-primary" type="submit">
                  <Icon name="plus" size={15} />
                  Add card
                </button>
              </form>
            )}
          </section>
        </div>
      )}

      {showWelcome && (
        <div className="dialog-backdrop welcome-backdrop">
          <section
            className="dialog welcome-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-title"
          >
            <div className="welcome-icon">
              <Icon name="sparkle" size={22} />
            </div>
            <p className="welcome-kicker">WELCOME TO PDF FLASHCARDS</p>
            <h2 id="welcome-title">Make study time count.</h2>
            <p className="welcome-intro">
              Create flashcards from your notes, then use a focused study flow
              to remember what matters.
            </p>
            <ul className="welcome-features">
              <li>
                <Icon name="rotate" size={16} />
                <span><strong>Study actively</strong> — flip each card to reveal its definition.</span>
              </li>
              <li>
                <Icon name="check" size={16} />
                <span><strong>Track your progress</strong> — mark cards mastered or flag them for review.</span>
              </li>
              <li>
                <Icon name="shuffle" size={16} />
                <span><strong>Stay in control</strong> — browse, filter, shuffle, and navigate with keyboard shortcuts.</span>
              </li>
            </ul>
            <button
              className="welcome-primary"
              onClick={() => finishWelcome(true)}
            >
              <Icon name="plus" size={16} />
              Create your first card
            </button>
            <button
              className="welcome-secondary"
              onClick={() => finishWelcome()}
            >
              Explore the app
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
