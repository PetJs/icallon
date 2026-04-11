/**
 * useGameEvents.ts — WebSocket real-time event subscriptions for ICallOn
 *
 * ─── WHY WEBSOCKET INSTEAD OF POLLING ────────────────────────────────────────
 * Monad finalizes blocks every ~0.4 seconds. HTTP polling at even 1s intervals
 * means the UI is on average 0.5s behind the chain — visible lag during the
 * 35-second commit window. WebSocket push notifications arrive as soon as the
 * event is emitted, giving the UI sub-second reaction time that matches Monad's
 * actual finality.
 *
 * wagmi's useWatchContractEvent uses viem's watchContractEvent under the hood,
 * which opens a persistent eth_subscribe("logs") WebSocket subscription.
 * The WSS transport in wagmi.ts (wss://testnet-rpc.monad.xyz) handles this.
 *
 * ─── FALLBACK STRATEGY ───────────────────────────────────────────────────────
 * If the WebSocket connection drops (common on mobile/testnet), the event
 * callbacks stop firing but the polling in useICallOn.ts continues to keep
 * state fresh. Events are replayed when the WSS reconnects. This means the UI
 * degrades gracefully to polling-only mode rather than breaking entirely.
 *
 * ─── USAGE ───────────────────────────────────────────────────────────────────
 * Use useGameEvents(gameId) in page components to receive toast/UI updates
 * in real time. Use useSpecificEvent hooks for single-event subscriptions.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useWatchContractEvent } from "wagmi";

import { CONTRACT, GameState } from "@/lib/contract";
import { formatAddress } from "@/lib/utils";

// ── Event payload types ───────────────────────────────────────────────────────

export type GameCreatedEvent = {
  gameId:    bigint;
  admin:     `0x${string}`;
  prizePool: bigint;
  timestamp: number;
};

export type PlayerJoinedEvent = {
  gameId:      bigint;
  player:      `0x${string}`;
  playerCount: number;
  timestamp:   number;
};

export type RoundStartedEvent = {
  gameId:        bigint;
  round:         number;
  letter:        string;   // "M", "A", etc. — decoded from bytes1
  commitDeadline: bigint;
  timestamp:     number;
};

export type PhaseAdvancedEvent = {
  gameId:    bigint;
  newState:  GameState;
  timestamp: number;
};

export type AnswerCommittedEvent = {
  gameId:    bigint;
  player:    `0x${string}`;
  round:     number;
  timestamp: number;
};

export type AnswerRevealedEvent = {
  gameId:    bigint;
  player:    `0x${string}`;
  round:     number;
  timestamp: number;
};

export type AnswerFlaggedEvent = {
  gameId:        bigint;
  flagger:       `0x${string}`;
  flaggedPlayer: `0x${string}`;
  round:         number;
  category:      number;
  timestamp:     number;
};

export type RoundScoredEvent = {
  gameId:    bigint;
  round:     number;
  advancing: readonly `0x${string}`[];
  eliminated: readonly `0x${string}`[];
  timestamp: number;
};

export type GameCompleteEvent = {
  gameId:    bigint;
  winner:    `0x${string}`;
  prize:     bigint;
  timestamp: number;
};

// ── Toast notification type (surfaced to UI) ──────────────────────────────────
export type GameNotification = {
  id:        string;
  type:      "info" | "success" | "warning" | "error";
  title:     string;
  message:   string;
  timestamp: number;
};

// ── Internal: decode bytes1 to letter string ──────────────────────────────────
function decodeLetter(bytes1: string | undefined): string {
  if (!bytes1) return "?";
  const code = parseInt(bytes1.slice(2), 16);
  if (isNaN(code) || code < 65 || code > 90) return "?";
  return String.fromCharCode(code);
}

// ── Internal: generate a unique notification ID ───────────────────────────────
let notifCounter = 0;
function nextId(): string {
  return `notif_${Date.now()}_${notifCounter++}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//                        SINGLE-EVENT HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

// ── useOnPlayerJoined ─────────────────────────────────────────────────────────
/**
 * Subscribe to PlayerJoined events for a specific game.
 * Fires onJoin(event) in real-time via WebSocket push.
 * Used in the lobby page to animate players arriving.
 */
export function useOnPlayerJoined(
  gameId: bigint | undefined,
  onJoin: (event: PlayerJoinedEvent) => void
) {
  const onJoinRef = useRef(onJoin);
  useEffect(() => { onJoinRef.current = onJoin; }, [onJoin]);

  useWatchContractEvent({
    ...CONTRACT,
    eventName: "PlayerJoined",
    args:      gameId !== undefined ? { gameId } : undefined,
    enabled:   gameId !== undefined,
    onLogs(logs) {
      for (const log of logs) {
        const { gameId: gId, player, playerCount } = log.args as {
          gameId: bigint;
          player: `0x${string}`;
          playerCount: number;
        };
        onJoinRef.current({
          gameId:      gId,
          player,
          playerCount: Number(playerCount),
          timestamp:   Date.now(),
        });
      }
    },
    onError(err) {
      // WSS drop — polling fallback in useICallOn.ts keeps state fresh
      console.warn("[useOnPlayerJoined] WebSocket error, falling back to polling:", err.message);
    },
  });
}

// ── useOnRoundStarted ─────────────────────────────────────────────────────────
/**
 * Fires when the admin starts a round and a letter is chosen.
 * Used to trigger the full-screen LetterReveal animation.
 *
 * Monad note: this event fires within ~0.4s of startRound() being mined.
 * The LetterReveal animation can start immediately on receipt.
 */
export function useOnRoundStarted(
  gameId:  bigint | undefined,
  onStart: (event: RoundStartedEvent) => void
) {
  const onStartRef = useRef(onStart);
  useEffect(() => { onStartRef.current = onStart; }, [onStart]);

  useWatchContractEvent({
    ...CONTRACT,
    eventName: "RoundStarted",
    args:      gameId !== undefined ? { gameId } : undefined,
    enabled:   gameId !== undefined,
    onLogs(logs) {
      for (const log of logs) {
        const { gameId: gId, round, letter, commitDeadline } = log.args as {
          gameId: bigint;
          round: number;
          letter: string;
          commitDeadline: bigint;
        };
        onStartRef.current({
          gameId:         gId,
          round:          Number(round),
          letter:         decodeLetter(letter),
          commitDeadline,
          timestamp:      Date.now(),
        });
      }
    },
    onError(err) {
      console.warn("[useOnRoundStarted] WebSocket error:", err.message);
    },
  });
}

// ── useOnPhaseAdvanced ────────────────────────────────────────────────────────
/**
 * Fires on every state transition: COMMIT → REVEAL → FLAGGING → SCORING.
 * Used to drive phase-change UI updates (e.g. switching form visibility)
 * without waiting for the next polling cycle.
 */
export function useOnPhaseAdvanced(
  gameId:    bigint | undefined,
  onAdvance: (event: PhaseAdvancedEvent) => void
) {
  const onAdvanceRef = useRef(onAdvance);
  useEffect(() => { onAdvanceRef.current = onAdvance; }, [onAdvance]);

  useWatchContractEvent({
    ...CONTRACT,
    eventName: "PhaseAdvanced",
    args:      gameId !== undefined ? { gameId } : undefined,
    enabled:   gameId !== undefined,
    onLogs(logs) {
      for (const log of logs) {
        const { gameId: gId, newState } = log.args as {
          gameId: bigint;
          newState: number;
        };
        onAdvanceRef.current({
          gameId:    gId,
          newState:  newState as GameState,
          timestamp: Date.now(),
        });
      }
    },
    onError(err) {
      console.warn("[useOnPhaseAdvanced] WebSocket error:", err.message);
    },
  });
}

// ── useOnAnswerCommitted ──────────────────────────────────────────────────────
/**
 * Fires when any player commits their answer hash.
 * Used to update commit progress indicators in real-time.
 */
export function useOnAnswerCommitted(
  gameId:    bigint | undefined,
  onCommit:  (event: AnswerCommittedEvent) => void
) {
  const ref = useRef(onCommit);
  useEffect(() => { ref.current = onCommit; }, [onCommit]);

  useWatchContractEvent({
    ...CONTRACT,
    eventName: "AnswerCommitted",
    args:      gameId !== undefined ? { gameId } : undefined,
    enabled:   gameId !== undefined,
    onLogs(logs) {
      for (const log of logs) {
        const { gameId: gId, player, round } = log.args as {
          gameId: bigint; player: `0x${string}`; round: number;
        };
        ref.current({ gameId: gId, player, round: Number(round), timestamp: Date.now() });
      }
    },
    onError(err) {
      console.warn("[useOnAnswerCommitted] WebSocket error:", err.message);
    },
  });
}

// ── useOnAnswerRevealed ───────────────────────────────────────────────────────
/**
 * Fires when any player reveals their answers.
 * Used to update reveal progress indicators and trigger scoring UI refresh.
 */
export function useOnAnswerRevealed(
  gameId:   bigint | undefined,
  onReveal: (event: AnswerRevealedEvent) => void
) {
  const ref = useRef(onReveal);
  useEffect(() => { ref.current = onReveal; }, [onReveal]);

  useWatchContractEvent({
    ...CONTRACT,
    eventName: "AnswerRevealed",
    args:      gameId !== undefined ? { gameId } : undefined,
    enabled:   gameId !== undefined,
    onLogs(logs) {
      for (const log of logs) {
        const { gameId: gId, player, round } = log.args as {
          gameId: bigint; player: `0x${string}`; round: number;
        };
        ref.current({ gameId: gId, player, round: Number(round), timestamp: Date.now() });
      }
    },
    onError(err) {
      console.warn("[useOnAnswerRevealed] WebSocket error:", err.message);
    },
  });
}

// ── useOnAnswerFlagged ────────────────────────────────────────────────────────
/**
 * Fires when any player flags an answer.
 * Used to animate flag count badges in real-time during flagging phase.
 */
export function useOnAnswerFlagged(
  gameId:  bigint | undefined,
  onFlag:  (event: AnswerFlaggedEvent) => void
) {
  const ref = useRef(onFlag);
  useEffect(() => { ref.current = onFlag; }, [onFlag]);

  useWatchContractEvent({
    ...CONTRACT,
    eventName: "AnswerFlagged",
    args:      gameId !== undefined ? { gameId } : undefined,
    enabled:   gameId !== undefined,
    onLogs(logs) {
      for (const log of logs) {
        const { gameId: gId, flagger, flaggedPlayer, round, category } = log.args as {
          gameId: bigint; flagger: `0x${string}`; flaggedPlayer: `0x${string}`;
          round: number; category: number;
        };
        ref.current({
          gameId: gId, flagger, flaggedPlayer,
          round: Number(round), category: Number(category),
          timestamp: Date.now(),
        });
      }
    },
    onError(err) {
      console.warn("[useOnAnswerFlagged] WebSocket error:", err.message);
    },
  });
}

// ── useOnRoundScored ──────────────────────────────────────────────────────────
/**
 * Fires when a round is scored and players advance/are eliminated.
 * Used to trigger elimination animations and advance to next round.
 */
export function useOnRoundScored(
  gameId:  bigint | undefined,
  onScore: (event: RoundScoredEvent) => void
) {
  const ref = useRef(onScore);
  useEffect(() => { ref.current = onScore; }, [onScore]);

  useWatchContractEvent({
    ...CONTRACT,
    eventName: "RoundScored",
    args:      gameId !== undefined ? { gameId } : undefined,
    enabled:   gameId !== undefined,
    onLogs(logs) {
      for (const log of logs) {
        const { gameId: gId, round, advancing, eliminated } = log.args as {
          gameId: bigint; round: number;
          advancing: readonly `0x${string}`[];
          eliminated: readonly `0x${string}`[];
        };
        ref.current({
          gameId: gId, round: Number(round),
          advancing, eliminated, timestamp: Date.now(),
        });
      }
    },
    onError(err) {
      console.warn("[useOnRoundScored] WebSocket error:", err.message);
    },
  });
}

// ── useOnGameComplete ─────────────────────────────────────────────────────────
/**
 * Fires when the game ends and the winner is paid.
 * Used to trigger the winner screen and prize confirmation.
 *
 * Monad note: prize transfer happens in the same tx as scoreRound() —
 * the GameComplete event fires in the same block, meaning the winner
 * sees their MON balance update within ~0.4s of the final round being scored.
 */
export function useOnGameComplete(
  gameId:     bigint | undefined,
  onComplete: (event: GameCompleteEvent) => void
) {
  const ref = useRef(onComplete);
  useEffect(() => { ref.current = onComplete; }, [onComplete]);

  useWatchContractEvent({
    ...CONTRACT,
    eventName: "GameComplete",
    args:      gameId !== undefined ? { gameId } : undefined,
    enabled:   gameId !== undefined,
    onLogs(logs) {
      for (const log of logs) {
        const { gameId: gId, winner, prize } = log.args as {
          gameId: bigint; winner: `0x${string}`; prize: bigint;
        };
        ref.current({ gameId: gId, winner, prize, timestamp: Date.now() });
      }
    },
    onError(err) {
      console.warn("[useOnGameComplete] WebSocket error:", err.message);
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//               COMPOSITE HOOK — useGameEvents
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * useGameEvents — single hook that subscribes to ALL game events for a gameId.
 *
 * Returns:
 *  - notifications: rolling list of toast messages (max 20)
 *  - lastEvent: the most recent event of any type
 *  - clearNotifications(): dismiss all toasts
 *  - Per-event last-seen values (lastPlayerJoined, lastRoundStarted, etc.)
 *
 * Usage:
 *   const { notifications, lastRoundStarted } = useGameEvents(gameId)
 *   // Show LetterReveal when lastRoundStarted changes
 */
export type GameEvents = {
  notifications:     GameNotification[];
  clearNotifications: () => void;
  lastPlayerJoined:  PlayerJoinedEvent | null;
  lastRoundStarted:  RoundStartedEvent | null;
  lastPhaseAdvanced: PhaseAdvancedEvent | null;
  lastAnswerCommitted: AnswerCommittedEvent | null;
  lastAnswerRevealed:  AnswerRevealedEvent | null;
  lastAnswerFlagged:   AnswerFlaggedEvent | null;
  lastRoundScored:     RoundScoredEvent | null;
  lastGameComplete:    GameCompleteEvent | null;
  commitCount:         number;  // how many players have committed this round
  revealCount:         number;  // how many players have revealed this round
};

const MAX_NOTIFICATIONS = 20;

export function useGameEvents(gameId: bigint | undefined): GameEvents {
  const [notifications, setNotifications]         = useState<GameNotification[]>([]);
  const [lastPlayerJoined, setLastPlayerJoined]   = useState<PlayerJoinedEvent | null>(null);
  const [lastRoundStarted, setLastRoundStarted]   = useState<RoundStartedEvent | null>(null);
  const [lastPhaseAdvanced, setLastPhaseAdvanced] = useState<PhaseAdvancedEvent | null>(null);
  const [lastAnswerCommitted, setLastAnswerCommitted] = useState<AnswerCommittedEvent | null>(null);
  const [lastAnswerRevealed,  setLastAnswerRevealed]  = useState<AnswerRevealedEvent | null>(null);
  const [lastAnswerFlagged,   setLastAnswerFlagged]   = useState<AnswerFlaggedEvent | null>(null);
  const [lastRoundScored,  setLastRoundScored]     = useState<RoundScoredEvent | null>(null);
  const [lastGameComplete, setLastGameComplete]    = useState<GameCompleteEvent | null>(null);

  // Running counts reset per round (used for progress bars)
  const [commitCount, setCommitCount] = useState(0);
  const [revealCount, setRevealCount] = useState(0);

  const addNotif = useCallback((n: Omit<GameNotification, "id" | "timestamp">) => {
    const notif: GameNotification = { ...n, id: nextId(), timestamp: Date.now() };
    setNotifications((prev) =>
      [notif, ...prev].slice(0, MAX_NOTIFICATIONS)
    );
  }, []);

  // Reset counts when phase advances (new round)
  const handlePhaseAdvanced = useCallback((event: PhaseAdvancedEvent) => {
    setLastPhaseAdvanced(event);

    if (event.newState === GameState.COMMIT) {
      setCommitCount(0);
      setRevealCount(0);
    }
    if (event.newState === GameState.REVEAL) {
      setRevealCount(0);
    }

    const phaseLabels: Record<GameState, string> = {
      [GameState.WAITING]:  "Waiting for players",
      [GameState.COMMIT]:   "Answer window open — 35 seconds!",
      [GameState.REVEAL]:   "Reveal window open",
      [GameState.FLAGGING]: "Flagging window open",
      [GameState.SCORING]:  "Scoring round…",
      [GameState.COMPLETE]: "Game complete",
    };
    addNotif({
      type:    event.newState === GameState.COMMIT ? "success" : "info",
      title:   "Phase changed",
      message: phaseLabels[event.newState],
    });
  }, [addNotif]);

  useOnPlayerJoined(gameId, useCallback((event) => {
    setLastPlayerJoined(event);
    addNotif({
      type:    "info",
      title:   "Player joined",
      message: `${formatAddress(event.player)} joined (${event.playerCount}/2)`,
    });
  }, [addNotif]));

  useOnRoundStarted(gameId, useCallback((event) => {
    setLastRoundStarted(event);
    setCommitCount(0);
    setRevealCount(0);
    addNotif({
      type:    "success",
      title:   `Round ${event.round} — Letter "${event.letter}"`,
      message: "35 seconds to submit your answers!",
    });
  }, [addNotif]));

  useOnPhaseAdvanced(gameId, handlePhaseAdvanced);

  useOnAnswerCommitted(gameId, useCallback((event) => {
    setLastAnswerCommitted(event);
    setCommitCount((n) => n + 1);
    addNotif({
      type:    "info",
      title:   "Answer committed",
      message: `${formatAddress(event.player)} locked in their answers`,
    });
  }, [addNotif]));

  useOnAnswerRevealed(gameId, useCallback((event) => {
    setLastAnswerRevealed(event);
    setRevealCount((n) => n + 1);
    addNotif({
      type:    "info",
      title:   "Answers revealed",
      message: `${formatAddress(event.player)} revealed their answers`,
    });
  }, [addNotif]));

  useOnAnswerFlagged(gameId, useCallback((event) => {
    setLastAnswerFlagged(event);
    const catLabels = ["Person", "Place", "Thing", "Animal", "Food"];
    addNotif({
      type:    "warning",
      title:   "Answer flagged",
      message: `${formatAddress(event.flagger)} flagged ${formatAddress(event.flaggedPlayer)}'s ${catLabels[event.category] ?? "answer"}`,
    });
  }, [addNotif]));

  useOnRoundScored(gameId, useCallback((event) => {
    setLastRoundScored(event);
    addNotif({
      type:    "success",
      title:   `Round ${event.round} scored`,
      message: `${event.advancing.length} players advance, ${event.eliminated.length} eliminated`,
    });
  }, [addNotif]));

  useOnGameComplete(gameId, useCallback((event) => {
    setLastGameComplete(event);
    addNotif({
      type:    "success",
      title:   "Game over!",
      message: `${formatAddress(event.winner)} wins the prize pool!`,
    });
  }, [addNotif]));

  const clearNotifications = useCallback(() => setNotifications([]), []);

  return {
    notifications,
    clearNotifications,
    lastPlayerJoined,
    lastRoundStarted,
    lastPhaseAdvanced,
    lastAnswerCommitted,
    lastAnswerRevealed,
    lastAnswerFlagged,
    lastRoundScored,
    lastGameComplete,
    commitCount,
    revealCount,
  };
}
