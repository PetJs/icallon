/**
 * useICallOn.ts — All contract read and write hooks for ICallOn
 *
 * Organized into sections:
 *  1. Read hooks  — game state, players, scores, timing
 *  2. Write hooks — join, commit, reveal, flag, admin actions
 *  3. Derived hooks — computed values built on top of reads
 *
 * Every hook:
 *  - Returns typed data (no `any`)
 *  - Surfaces errors via getErrorMessage()
 *  - Polls at appropriate intervals given Monad's 0.4s finality
 *
 * MONAD POLLING NOTE:
 *   wagmi's useReadContract polls on a fixed interval when `watch: true`.
 *   On Monad, blocks finalize every ~0.4s. We use:
 *     - 2s polling for slow-changing data (player list, game state)
 *     - 1s polling for time-sensitive data (phase deadlines, commit status)
 *   useWatchContractEvent (WebSocket) is used for real-time events in
 *   useGameEvents.ts — this file handles the polling fallback reads.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import {
  CATEGORY_LABELS,
  CONTRACT,
  Category,
  CommitData,
  GameData,
  GameState,
  PlayerData,
  RoundData,
  Scoreboard,
} from "@/lib/contract";
import {
  generateSalt,
  getErrorMessage,
  getTimeRemaining,
  hashAnswers,
  isDeadlinePassed,
  loadAnswers,
  loadSalt,
  saveAnswers,
  saveSalt,
} from "@/lib/utils";

// ── Shared poll interval constants ────────────────────────────────────────────
const POLL_SLOW   = 2_000; // ms — game state, player list
const POLL_FAST   = 1_000; // ms — deadlines, commit/reveal status

// ═══════════════════════════════════════════════════════════════════════════════
//                           1. READ HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

// ── useGameData — core game struct ────────────────────────────────────────────
export function useGameData(gameId: bigint | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    ...CONTRACT,
    functionName: "games",
    args:         gameId !== undefined ? [gameId] : undefined,
    query: {
      enabled:           gameId !== undefined,
      refetchInterval:   POLL_SLOW,
    },
  });

  const game = useMemo((): GameData | undefined => {
    if (!data) return undefined;
    const [id, admin, prizePool, stateRaw, currentRound, playerCount, winner, exists] = data;
    return {
      id,
      admin,
      prizePool,
      state:        stateRaw as GameState,
      currentRound: Number(currentRound),
      playerCount:  Number(playerCount),
      winner,
      exists,
    };
  }, [data]);

  return { game, isLoading, error: error ? getErrorMessage(error) : null, refetch };
}

// ── useRoundData — timing + letter for current round ─────────────────────────
export function useRoundData(gameId: bigint | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    ...CONTRACT,
    functionName: "getRoundData",
    args:         gameId !== undefined ? [gameId] : undefined,
    query: {
      enabled:         gameId !== undefined,
      refetchInterval: POLL_FAST,
    },
  });

  const roundData = useMemo((): RoundData | undefined => {
    if (!data) return undefined;
    return {
      letter:            Number(data.letter),
      commitDeadline:    data.commitDeadline,
      revealDeadline:    data.revealDeadline,
      flagDeadline:      data.flagDeadline,
      activePlayerCount: Number(data.activePlayerCount),
    };
  }, [data]);

  return { roundData, isLoading, error: error ? getErrorMessage(error) : null, refetch };
}

// ── useActivePlayers — live list of active player addresses ──────────────────
export function useActivePlayers(gameId: bigint | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    ...CONTRACT,
    functionName: "getActivePlayers",
    args:         gameId !== undefined ? [gameId] : undefined,
    query: {
      enabled:         gameId !== undefined,
      refetchInterval: POLL_SLOW,
    },
  });

  return {
    activePlayers: (data ?? []) as readonly `0x${string}`[],
    count:         data?.length ?? 0,
    isLoading,
    error:         error ? getErrorMessage(error) : null,
    refetch,
  };
}

// ── usePlayerData — single player's data struct ───────────────────────────────
export function usePlayerData(
  gameId:  bigint | undefined,
  address: `0x${string}` | undefined
) {
  const { data, isLoading, error, refetch } = useReadContract({
    ...CONTRACT,
    functionName: "getPlayer",
    args:         gameId !== undefined && address ? [gameId, address] : undefined,
    query: {
      enabled:         gameId !== undefined && !!address,
      refetchInterval: POLL_FAST,
    },
  });

  const player = useMemo((): PlayerData | undefined => {
    if (!data) return undefined;
    return {
      addr:         data.addr,
      totalScore:   data.totalScore,
      roundScore:   data.roundScore,
      isActive:     data.isActive,
      hasCommitted: data.hasCommitted,
      hasRevealed:  data.hasRevealed,
    };
  }, [data]);

  return { player, isLoading, error: error ? getErrorMessage(error) : null, refetch };
}

// ── useIsPlayer — check if an address is in a game ───────────────────────────
export function useIsPlayer(
  gameId:  bigint | undefined,
  address: `0x${string}` | undefined
) {
  const { data, isLoading, refetch } = useReadContract({
    ...CONTRACT,
    functionName: "isPlayer",
    args:         gameId !== undefined && address ? [gameId, address] : undefined,
    query: {
      enabled:         gameId !== undefined && !!address,
      refetchInterval: POLL_SLOW,
    },
  });

  return { isPlayer: data ?? false, isLoading, refetch };
}

// ── useScoreboard — full scoreboard for a game ────────────────────────────────
export function useScoreboard(gameId: bigint | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    ...CONTRACT,
    functionName: "getScoreboard",
    args:         gameId !== undefined ? [gameId] : undefined,
    query: {
      enabled:         gameId !== undefined,
      refetchInterval: POLL_SLOW,
    },
  });

  const scoreboard = useMemo((): Scoreboard | undefined => {
    if (!data) return undefined;
    const [addrs, roundScores, totalScores, activeStatus] = data;
    return { addrs, roundScores, totalScores, activeStatus };
  }, [data]);

  return {
    scoreboard,
    isLoading,
    error: error ? getErrorMessage(error) : null,
    refetch,
  };
}

// ── useRevealedAnswers — a player's revealed answers for a round ──────────────
export function useRevealedAnswers(
  gameId:  bigint | undefined,
  round:   number | undefined,
  address: `0x${string}` | undefined
) {
  const { data, isLoading, error, refetch } = useReadContract({
    ...CONTRACT,
    functionName: "getRevealedAnswers",
    args:
      gameId !== undefined && round !== undefined && address
        ? [gameId, round, address]
        : undefined,
    query: {
      enabled:         gameId !== undefined && round !== undefined && !!address,
      refetchInterval: POLL_FAST,
    },
  });

  return {
    answers:  (data?.[0] ?? ["", "", "", "", ""]) as [string, string, string, string, string],
    revealed: data?.[1] ?? false,
    isLoading,
    error:    error ? getErrorMessage(error) : null,
    refetch,
  };
}

// ── useCommitData — a player's commit for a round ────────────────────────────
export function useCommitData(
  gameId:  bigint | undefined,
  round:   number | undefined,
  address: `0x${string}` | undefined
) {
  const { data, isLoading, refetch } = useReadContract({
    ...CONTRACT,
    functionName: "getCommitData",
    args:
      gameId !== undefined && round !== undefined && address
        ? [gameId, round, address]
        : undefined,
    query: {
      enabled:         gameId !== undefined && round !== undefined && !!address,
      refetchInterval: POLL_FAST,
    },
  });

  const commitData = useMemo((): CommitData | undefined => {
    if (!data) return undefined;
    return {
      commitHash:      data.commitHash,
      commitTimestamp: data.commitTimestamp,
      committed:       data.committed,
    };
  }, [data]);

  return { commitData, isLoading, refetch };
}

// ── useFlagCount — flag count for a specific answer ───────────────────────────
export function useFlagCount(
  gameId:   bigint | undefined,
  round:    number | undefined,
  player:   `0x${string}` | undefined,
  category: Category
) {
  const { data, refetch } = useReadContract({
    ...CONTRACT,
    functionName: "getFlagCount",
    args:
      gameId !== undefined && round !== undefined && player
        ? [gameId, round, player, category]
        : undefined,
    query: {
      enabled:         gameId !== undefined && round !== undefined && !!player,
      refetchInterval: POLL_FAST,
    },
  });

  return { flagCount: Number(data ?? 0), refetch };
}

// ── useHasFlagged — has the current user flagged a specific answer ─────────────
export function useHasFlagged(
  gameId:        bigint | undefined,
  round:         number | undefined,
  flaggedPlayer: `0x${string}` | undefined,
  category:      Category
) {
  const { data, refetch } = useReadContract({
    ...CONTRACT,
    functionName: "hasFlagged",
    args:
      gameId !== undefined && round !== undefined && flaggedPlayer
        ? [gameId, round, flaggedPlayer, category]
        : undefined,
    query: {
      enabled:         gameId !== undefined && round !== undefined && !!flaggedPlayer,
      refetchInterval: POLL_FAST,
    },
  });

  return { hasFlagged: data ?? false, refetch };
}

// ── useAllPlayerData — batch-fetch PlayerData for all player slots ─────────────
// Uses useReadContracts to batch up to 16 calls into a single multicall.
export function useAllPlayerData(
  gameId:      bigint | undefined,
  playerCount: number
) {
  const contracts = useMemo(() => {
    if (gameId === undefined || playerCount === 0) return [];
    return Array.from({ length: playerCount }, (_, i) => ({
      ...CONTRACT,
      functionName: "players" as const,
      args:         [gameId, i] as const,
    }));
  }, [gameId, playerCount]);

  const { data, isLoading, refetch } = useReadContracts({
    contracts,
    query: {
      enabled:         gameId !== undefined && playerCount > 0,
      refetchInterval: POLL_SLOW,
    },
  });

  const playerList = useMemo((): PlayerData[] => {
    if (!data) return [];
    return data
      .filter((r) => r.status === "success" && r.result)
      .map((r) => {
        const d = r.result as readonly [
          `0x${string}`, bigint, bigint, boolean, boolean, boolean
        ];
        return {
          addr:         d[0],
          totalScore:   d[1],
          roundScore:   d[2],
          isActive:     d[3],
          hasCommitted: d[4],
          hasRevealed:  d[5],
        };
      });
  }, [data]);

  return { playerList, isLoading, refetch };
}

// ── useAllRevealedAnswers — fetch revealed answers for all active players ──────
// Used in the results/flagging page to show the full answer grid.
export function useAllRevealedAnswers(
  gameId:         bigint | undefined,
  round:          number | undefined,
  playerAddresses: readonly `0x${string}`[]
) {
  const contracts = useMemo(() => {
    if (gameId === undefined || round === undefined || playerAddresses.length === 0) return [];
    return playerAddresses.map((addr) => ({
      ...CONTRACT,
      functionName: "getRevealedAnswers" as const,
      args:         [gameId, round, addr] as const,
    }));
  }, [gameId, round, playerAddresses]);

  const { data, isLoading, refetch } = useReadContracts({
    contracts,
    query: {
      enabled:         gameId !== undefined && round !== undefined && playerAddresses.length > 0,
      refetchInterval: POLL_FAST,
    },
  });

  const answersMap = useMemo((): Map<`0x${string}`, [string,string,string,string,string]> => {
    const map = new Map<`0x${string}`, [string,string,string,string,string]>();
    if (!data) return map;
    data.forEach((r, i) => {
      if (r.status === "success" && r.result && r.result[1]) {
        map.set(playerAddresses[i], r.result[0] as [string,string,string,string,string]);
      }
    });
    return map;
  }, [data, playerAddresses]);

  return { answersMap, isLoading, refetch };
}

// ═══════════════════════════════════════════════════════════════════════════════
//                           2. WRITE HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

// Shared write hook shape
export type WriteHookResult = {
  execute:      (...args: unknown[]) => void;
  isPending:    boolean;   // wallet confirmation pending
  isConfirming: boolean;   // waiting for on-chain inclusion
  isSuccess:    boolean;
  error:        string | null;
  txHash:       `0x${string}` | undefined;
  reset:        () => void;
};

// ── useJoinGame ───────────────────────────────────────────────────────────────
export function useJoinGame(gameId: bigint | undefined): WriteHookResult {
  const [error, setError] = useState<string | null>(null);

  const {
    writeContract, data: txHash, isPending,
    error: writeError, reset: resetWrite,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  useEffect(() => {
    if (writeError) setError(getErrorMessage(writeError));
  }, [writeError]);

  const execute = useCallback(() => {
    if (gameId === undefined) return;
    setError(null);
    writeContract({ ...CONTRACT, functionName: "joinGame", args: [gameId] });
  }, [gameId, writeContract]);

  const reset = useCallback(() => {
    resetWrite();
    setError(null);
  }, [resetWrite]);

  return { execute, isPending, isConfirming, isSuccess, error, txHash, reset };
}

// ── useCommitAnswers ──────────────────────────────────────────────────────────
export function useCommitAnswers(
  gameId: bigint | undefined,
  round:  number | undefined
) {
  const [error, setError] = useState<string | null>(null);
  // Store the salt and answers so the reveal hook can read them
  const [pendingSalt, setPendingSalt] = useState<`0x${string}` | null>(null);

  const {
    writeContract, data: txHash, isPending,
    error: writeError, reset: resetWrite,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  useEffect(() => {
    if (writeError) setError(getErrorMessage(writeError));
  }, [writeError]);

  /**
   * @param answers 5 answers [person, place, thing, animal, food]
   * Generates a random salt, hashes answers, saves both to sessionStorage,
   * then submits the commit hash on-chain.
   */
  const execute = useCallback(
    (answers: [string, string, string, string, string]) => {
      if (gameId === undefined || round === undefined) return;
      setError(null);

      const salt = generateSalt();
      const commitHash = hashAnswers(answers, salt);

      // Persist in sessionStorage so the reveal works even after a refresh
      saveSalt(gameId, round, salt);
      saveAnswers(gameId, round, answers);
      setPendingSalt(salt);

      writeContract({
        ...CONTRACT,
        functionName: "commitAnswers",
        args: [gameId, commitHash],
      });
    },
    [gameId, round, writeContract]
  );

  const reset = useCallback(() => {
    resetWrite();
    setError(null);
    setPendingSalt(null);
  }, [resetWrite]);

  return {
    execute,
    isPending,
    isConfirming,
    isSuccess,
    error,
    txHash,
    reset,
    pendingSalt,
  };
}

// ── useRevealAnswers ──────────────────────────────────────────────────────────
export function useRevealAnswers(
  gameId: bigint | undefined,
  round:  number | undefined
) {
  const [error, setError] = useState<string | null>(null);

  const {
    writeContract, data: txHash, isPending,
    error: writeError, reset: resetWrite,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  useEffect(() => {
    if (writeError) setError(getErrorMessage(writeError));
  }, [writeError]);

  /**
   * Loads the saved answers and salt from sessionStorage, then reveals on-chain.
   * Requires that useCommitAnswers was called earlier this round (which saves
   * the data to sessionStorage).
   *
   * @param answers Optionally pass answers directly (overrides sessionStorage)
   * @param salt    Optionally pass salt directly (overrides sessionStorage)
   */
  const execute = useCallback(
    (
      answers?: [string, string, string, string, string],
      salt?:    `0x${string}`
    ) => {
      if (gameId === undefined || round === undefined) return;
      setError(null);

      // Load from sessionStorage if not passed directly
      const resolvedAnswers = answers ?? loadAnswers(gameId, round);
      const resolvedSalt    = salt    ?? loadSalt(gameId, round);

      if (!resolvedAnswers) {
        setError("Answers not found. Did you commit this round?");
        return;
      }
      if (!resolvedSalt) {
        setError("Salt not found. Did you commit this round?");
        return;
      }

      writeContract({
        ...CONTRACT,
        functionName: "revealAnswers",
        args: [gameId, resolvedAnswers, resolvedSalt],
      });
    },
    [gameId, round, writeContract]
  );

  const reset = useCallback(() => {
    resetWrite();
    setError(null);
  }, [resetWrite]);

  // Expose saved data so the UI can show "your answers" during reveal phase
  const savedAnswers = gameId !== undefined && round !== undefined
    ? loadAnswers(gameId, round)
    : null;

  return {
    execute,
    isPending,
    isConfirming,
    isSuccess,
    error,
    txHash,
    reset,
    savedAnswers,
  };
}

// ── useFlagAnswer ─────────────────────────────────────────────────────────────
export function useFlagAnswer(
  gameId: bigint | undefined,
  round:  number | undefined
) {
  const [error, setError] = useState<string | null>(null);

  const {
    writeContract, data: txHash, isPending,
    error: writeError, reset: resetWrite,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  useEffect(() => {
    if (writeError) setError(getErrorMessage(writeError));
  }, [writeError]);

  const execute = useCallback(
    (flaggedPlayer: `0x${string}`, category: Category) => {
      if (gameId === undefined || round === undefined) return;
      setError(null);
      writeContract({
        ...CONTRACT,
        functionName: "flagAnswer",
        args: [gameId, flaggedPlayer, category],
      });
    },
    [gameId, round, writeContract]
  );

  const reset = useCallback(() => {
    resetWrite();
    setError(null);
  }, [resetWrite]);

  return { execute, isPending, isConfirming, isSuccess, error, txHash, reset };
}

// ── Admin write hooks ──────────────────────────────────────────────────────────

function useAdminWrite(
  gameId:       bigint | undefined,
  functionName: "startRound" | "openReveal" | "openFlagging" | "scoreRound" | "emergencyWithdraw"
): WriteHookResult {
  const [error, setError] = useState<string | null>(null);

  const {
    writeContract, data: txHash, isPending,
    error: writeError, reset: resetWrite,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  useEffect(() => {
    if (writeError) setError(getErrorMessage(writeError));
  }, [writeError]);

  const execute = useCallback(() => {
    if (gameId === undefined) return;
    setError(null);
    writeContract({ ...CONTRACT, functionName, args: [gameId] });
  }, [gameId, functionName, writeContract]);

  const reset = useCallback(() => {
    resetWrite();
    setError(null);
  }, [resetWrite]);

  return { execute, isPending, isConfirming, isSuccess, error, txHash, reset };
}

export const useStartRound       = (g: bigint | undefined) => useAdminWrite(g, "startRound");
export const useOpenReveal       = (g: bigint | undefined) => useAdminWrite(g, "openReveal");
export const useOpenFlagging     = (g: bigint | undefined) => useAdminWrite(g, "openFlagging");
export const useScoreRound       = (g: bigint | undefined) => useAdminWrite(g, "scoreRound");
export const useEmergencyWithdraw= (g: bigint | undefined) => useAdminWrite(g, "emergencyWithdraw");

// ── useCreateGame ─────────────────────────────────────────────────────────────
export function useCreateGame() {
  const [error, setError] = useState<string | null>(null);
  const [createdGameId, setCreatedGameId] = useState<bigint | null>(null);

  const {
    writeContract, data: txHash, isPending,
    error: writeError, reset: resetWrite,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess,
    data: receipt,
  } = useWaitForTransactionReceipt({ hash: txHash });

  // Extract gameId from GameCreated event log
  useEffect(() => {
    if (!isSuccess || !receipt) return;
    for (const log of receipt.logs) {
      const topic = log.topics[1];
      if (topic) {
        try {
          const id = BigInt(topic);
          if (id > 0n) { setCreatedGameId(id); break; }
        } catch {}
      }
    }
  }, [isSuccess, receipt]);

  useEffect(() => {
    if (writeError) setError(getErrorMessage(writeError));
  }, [writeError]);

  const execute = useCallback(
    (prizeWei: bigint) => {
      setError(null);
      setCreatedGameId(null);
      writeContract({
        ...CONTRACT,
        functionName: "createGame",
        value:        prizeWei,
      });
    },
    [writeContract]
  );

  const reset = useCallback(() => {
    resetWrite();
    setError(null);
    setCreatedGameId(null);
  }, [resetWrite]);

  return {
    execute,
    isPending,
    isConfirming,
    isSuccess,
    error,
    txHash,
    reset,
    createdGameId,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//                         3. DERIVED / COMPOSITE HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

// ── useGamePhase — current phase info + countdown ────────────────────────────
export type GamePhase = {
  state:           GameState;
  label:           string;
  timeRemaining:   number;        // seconds
  deadlinePassed:  boolean;
  activeDeadline:  bigint | null;
};

export function useGamePhase(
  gameId:    bigint | undefined,
  pollMs:    number = POLL_FAST
) {
  const { game }      = useGameData(gameId);
  const { roundData } = useRoundData(gameId);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Tick every second for countdown display
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(id);
  }, []);

  return useMemo((): GamePhase => {
    const state = game?.state ?? GameState.WAITING;

    let activeDeadline: bigint | null = null;
    if (roundData) {
      if (state === GameState.COMMIT)   activeDeadline = roundData.commitDeadline;
      if (state === GameState.REVEAL)   activeDeadline = roundData.revealDeadline;
      if (state === GameState.FLAGGING) activeDeadline = roundData.flagDeadline;
    }

    const timeRemaining = activeDeadline
      ? Math.max(0, Number(activeDeadline) - now)
      : 0;

    const labels: Record<GameState, string> = {
      [GameState.WAITING]:  "Waiting for players",
      [GameState.COMMIT]:   "Submit your answers",
      [GameState.REVEAL]:   "Reveal your answers",
      [GameState.FLAGGING]: "Flag bad answers",
      [GameState.SCORING]:  "Calculating scores…",
      [GameState.COMPLETE]: "Game over",
    };

    return {
      state,
      label:          labels[state],
      timeRemaining,
      deadlinePassed: activeDeadline ? isDeadlinePassed(activeDeadline) : false,
      activeDeadline,
    };
  }, [game?.state, roundData, now]);
}

// ── useMyGameStatus — everything the current player needs to know ─────────────
export type MyGameStatus = {
  isInGame:         boolean;
  isActive:         boolean;      // not eliminated
  hasCommitted:     boolean;
  hasRevealed:      boolean;
  roundScore:       bigint;
  totalScore:       bigint;
  isAdmin:          boolean;
  canCommit:        boolean;
  canReveal:        boolean;
  canFlag:          boolean;
};

export function useMyGameStatus(gameId: bigint | undefined) {
  const { address }                = useAccount();
  const { game }                   = useGameData(gameId);
  const { isPlayer }               = useIsPlayer(gameId, address);
  const { player }                 = usePlayerData(gameId, address);
  const { state, deadlinePassed }  = useGamePhase(gameId);

  return useMemo((): MyGameStatus => {
    const isAdmin    = !!address && !!game && game.admin.toLowerCase() === address.toLowerCase();
    const isActive   = player?.isActive ?? false;
    const committed  = player?.hasCommitted ?? false;
    const revealed   = player?.hasRevealed  ?? false;

    return {
      isInGame:     isPlayer,
      isActive,
      hasCommitted: committed,
      hasRevealed:  revealed,
      roundScore:   player?.roundScore  ?? 0n,
      totalScore:   player?.totalScore  ?? 0n,
      isAdmin,
      // canCommit: in game, active, not yet committed, deadline not passed
      canCommit:    isPlayer && isActive && !committed && state === GameState.COMMIT && !deadlinePassed,
      // canReveal: in game, active, committed but not revealed, deadline not passed
      canReveal:    isPlayer && isActive && committed && !revealed && state === GameState.REVEAL && !deadlinePassed,
      // canFlag: in game, active, flagging phase open
      canFlag:      isPlayer && isActive && state === GameState.FLAGGING && !deadlinePassed,
    };
  }, [address, game, isPlayer, player, state, deadlinePassed]);
}

// ── useLeaderboard — sorted scoreboard (by total score desc) ─────────────────
export type LeaderboardEntry = {
  rank:        number;
  address:     `0x${string}`;
  totalScore:  bigint;
  roundScore:  bigint;
  isActive:    boolean;
};

export function useLeaderboard(gameId: bigint | undefined) {
  const { scoreboard, isLoading, refetch } = useScoreboard(gameId);

  const leaderboard = useMemo((): LeaderboardEntry[] => {
    if (!scoreboard) return [];

    const entries = scoreboard.addrs.map((addr, i) => ({
      address:    addr,
      totalScore: scoreboard.totalScores[i],
      roundScore: scoreboard.roundScores[i],
      isActive:   scoreboard.activeStatus[i],
    }));

    // Sort active players first, then by total score desc
    return entries
      .sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        if (b.totalScore !== a.totalScore) return b.totalScore > a.totalScore ? 1 : -1;
        return 0;
      })
      .map((entry, i) => ({ ...entry, rank: i + 1 }));
  }, [scoreboard]);

  return { leaderboard, isLoading, refetch };
}

// ── useRoundLetter — current letter as a display character ('M', 'A', etc.) ──
export function useRoundLetter(gameId: bigint | undefined) {
  const { data } = useReadContract({
    ...CONTRACT,
    functionName: "getCurrentLetter",
    args:         gameId !== undefined ? [gameId] : undefined,
    query: {
      enabled:         gameId !== undefined,
      refetchInterval: POLL_SLOW,
    },
  });

  // viem returns bytes1 as "0x4d" — convert to "M"
  const letter = useMemo((): string => {
    if (!data) return "?";
    const charCode = parseInt((data as string).slice(2), 16);
    if (isNaN(charCode) || charCode < 65 || charCode > 90) return "?";
    return String.fromCharCode(charCode);
  }, [data]);

  return { letter, raw: data };
}

// ── useCategoryLabels — convenience export matching Category enum ─────────────
export { CATEGORY_LABELS };
export { Category };
