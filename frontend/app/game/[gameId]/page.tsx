"use client";

import {
  ArrowRight01Icon,
  CheckmarkCircle01Icon,
  EyeIcon,
  GameController01Icon,
  InformationCircleIcon,
  Loading03Icon,
  SquareLockPasswordIcon,
  Timer01Icon,
  UserGroupIcon,
} from "@hugeicons/react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { AnimatePresence, motion } from "framer-motion";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";

import AnswerForm from "@/components/game/AnswerForm";
import CountdownTimer from "@/components/game/CountdownTimer";
import LetterReveal from "@/components/game/LetterReveal";
import PlayerList from "@/components/game/PlayerList";
import {
  useAllPlayerData,
  useCommitAnswers,
  useGameData,
  useGamePhase,
  useMyGameStatus,
  useOpenFlagging,
  useOpenReveal,
  useRevealAnswers,
  useRoundData,
  useRoundLetter,
  useScoreRound,
  useStartRound,
} from "@/hooks/useICallOn";
import {
  useOnAnswerCommitted,
  useOnAnswerRevealed,
  useOnGameComplete,
  useOnPhaseAdvanced,
  useOnRoundScored,
  useOnRoundStarted,
} from "@/hooks/useGameEvents";
import { GameState } from "@/lib/contract";
import { cn, formatAddress, formatMON, roundLabel } from "@/lib/utils";

// ── Phase banner ──────────────────────────────────────────────────────────────
function PhaseBanner({
  state,
  round,
}: {
  state: GameState;
  round: number;
}) {
  const configs: Partial<Record<GameState, { label: string; color: string }>> = {
    [GameState.COMMIT]:   { label: "Submit your answers",  color: "text-[#008751] border-[#008751]/20 bg-[#008751]/10" },
    [GameState.REVEAL]:   { label: "Reveal your answers",  color: "text-[#DFAB01] border-[#DFAB01]/20 bg-[#DFAB01]/10" },
    [GameState.FLAGGING]: { label: "Flag bad answers",     color: "text-[#E03E3E] border-[#E03E3E]/20 bg-[#E03E3E]/10" },
    [GameState.SCORING]:  { label: "Calculating scores…",  color: "text-[#9B9B9B] border-[#2D2D2D] bg-[#1A1A1A]" },
  };
  const cfg = configs[state];
  if (!cfg) return null;

  return (
    <motion.div
      key={state}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-center justify-between px-4 py-2.5 rounded-[8px] border text-sm",
        cfg.color
      )}
    >
      <div className="flex items-center gap-2">
        {state === GameState.SCORING ? (
          <Loading03Icon size={14} className="animate-spin" />
        ) : (
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
        )}
        <span className="font-medium">{cfg.label}</span>
      </div>
      <span className="text-xs opacity-70">{roundLabel(round)}</span>
    </motion.div>
  );
}

// ── Commit progress bar ───────────────────────────────────────────────────────
function CommitProgress({
  committed,
  total,
}: {
  committed: number;
  total:     number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="label">Players committed</span>
        <span className="text-xs font-mono text-[#9B9B9B]">
          {committed}/{total}
        </span>
      </div>
      <div className="flex gap-0.5">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-all duration-300",
              i < committed ? "bg-[#008751]" : "bg-[#2D2D2D]"
            )}
          />
        ))}
      </div>
    </div>
  );
}

// ── Reveal progress bar ────────────────────────────────────────────────────────
function RevealProgress({
  revealed,
  total,
}: {
  revealed: number;
  total:    number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="label">Players revealed</span>
        <span className="text-xs font-mono text-[#9B9B9B]">
          {revealed}/{total}
        </span>
      </div>
      <div className="flex gap-0.5">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-all duration-300",
              i < revealed ? "bg-[#DFAB01]" : "bg-[#2D2D2D]"
            )}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//                          MAIN GAME PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function GamePage() {
  const params = useParams();
  const router = useRouter();
  const gameId = BigInt(params.gameId as string);

  const { address, isConnected } = useAccount();

  // ── Contract reads ────────────────────────────────────────────────────────
  const { game, refetch: refetchGame }       = useGameData(gameId);
  const { roundData, refetch: refetchRound } = useRoundData(gameId);
  const { letter }                           = useRoundLetter(gameId);
  const phase                                = useGamePhase(gameId);
  const myStatus                             = useMyGameStatus(gameId);
  const { playerList, refetch: refetchPlayers } = useAllPlayerData(
    gameId,
    game?.playerCount ?? 0
  );

  // ── Write hooks ───────────────────────────────────────────────────────────
  const commitAnswers = useCommitAnswers(gameId, game?.currentRound);
  const revealAnswers = useRevealAnswers(gameId, game?.currentRound);

  // Admin hooks
  const openReveal   = useOpenReveal(gameId);
  const openFlagging = useOpenFlagging(gameId);
  const scoreRound   = useScoreRound(gameId);
  const startRound   = useStartRound(gameId);

  // ── Letter reveal overlay ─────────────────────────────────────────────────
  const [showLetterReveal, setShowLetterReveal] = useState(false);
  const [revealLetter, setRevealLetter]         = useState("?");
  const hasShownRevealRef = useRef<number>(0); // track which round we showed

  // Show letter reveal when round starts
  useOnRoundStarted(gameId, useCallback((event) => {
    setRevealLetter(event.letter);
    setShowLetterReveal(true);
    hasShownRevealRef.current = event.round;
    refetchGame();
    refetchRound();
  }, [refetchGame, refetchRound]));

  // Also show on first load if we're mid-commit and haven't shown yet
  useEffect(() => {
    if (
      game?.state === GameState.COMMIT &&
      letter !== "?" &&
      hasShownRevealRef.current !== game.currentRound
    ) {
      setRevealLetter(letter);
      setShowLetterReveal(true);
      hasShownRevealRef.current = game.currentRound;
    }
  }, [game?.state, game?.currentRound, letter]);

  // ── Auto-reveal: fires immediately when REVEAL opens and player has committed ──
  const hasAutoRevealedRef = useRef(false);
  useEffect(() => {
    if (
      phase.state !== GameState.REVEAL ||
      !myStatus.hasCommitted ||
      myStatus.hasRevealed ||
      revealAnswers.isPending ||
      revealAnswers.isConfirming ||
      hasAutoRevealedRef.current
    ) return;
    hasAutoRevealedRef.current = true;
    revealAnswers.execute();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.state, myStatus.hasCommitted, myStatus.hasRevealed]);

  // ── Auto-advance phases (admin only) ─────────────────────────────────────
  // Admin just confirms the wallet popup when it appears — no button-clicking.
  const hasAutoOpenedRevealRef    = useRef(false);
  const hasAutoOpenedFlaggingRef  = useRef(false);
  useEffect(() => {
    if (!myStatus.isAdmin) return;
    // Auto open reveal when commit deadline passes (and no commit tx is still in flight)
    if (
      phase.state === GameState.COMMIT &&
      phase.deadlinePassed &&
      !commitAnswers.isPending && !commitAnswers.isConfirming &&
      !openReveal.isPending   && !openReveal.isConfirming &&
      !hasAutoOpenedRevealRef.current
    ) {
      hasAutoOpenedRevealRef.current = true;
      openReveal.execute();
    }
    // Auto open flagging when reveal deadline passes
    if (
      phase.state === GameState.REVEAL &&
      phase.deadlinePassed &&
      !openFlagging.isPending && !openFlagging.isConfirming &&
      !hasAutoOpenedFlaggingRef.current
    ) {
      hasAutoOpenedFlaggingRef.current = true;
      openFlagging.execute();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    myStatus.isAdmin, phase.state, phase.deadlinePassed,
    commitAnswers.isPending, commitAnswers.isConfirming,
  ]);

  // ── Live commit / reveal counts ────────────────────────────────────────────
  const [liveCommitCount, setLiveCommitCount] = useState(0);
  const [liveRevealCount, setLiveRevealCount] = useState(0);

  // Seed counts from playerList
  useEffect(() => {
    const committed = playerList.filter((p) => p.isActive && p.hasCommitted).length;
    const revealed  = playerList.filter((p) => p.isActive && p.hasRevealed).length;
    setLiveCommitCount(committed);
    setLiveRevealCount(revealed);
  }, [playerList]);

  useOnAnswerCommitted(gameId, useCallback(() => {
    setLiveCommitCount((n) => n + 1);
    refetchPlayers();
    refetchGame();   // playerCount grows as players auto-register
    refetchRound();  // activePlayerCount also updates
  }, [refetchPlayers, refetchGame, refetchRound]));

  useOnAnswerRevealed(gameId, useCallback(() => {
    setLiveRevealCount((n) => n + 1);
    refetchPlayers();
  }, [refetchPlayers]));

  // ── Phase transitions ──────────────────────────────────────────────────────
  useOnPhaseAdvanced(gameId, useCallback((event) => {
    refetchGame();
    refetchRound();
    if (event.newState === GameState.COMMIT) {
      setLiveCommitCount(0);
      setLiveRevealCount(0);
    }
    if (event.newState === GameState.REVEAL) {
      setLiveRevealCount(0);
    }
    // Navigate to results for flagging, scoring, and complete
    if (
      event.newState === GameState.FLAGGING ||
      event.newState === GameState.SCORING  ||
      event.newState === GameState.COMPLETE
    ) {
      router.push(`/results/${gameId}`);
    }
  }, [refetchGame, refetchRound, gameId, router]));

  useOnRoundScored(gameId, useCallback(() => {
    router.push(`/results/${gameId}`);
  }, [gameId, router]));

  useOnGameComplete(gameId, useCallback(() => {
    router.push(`/results/${gameId}`);
  }, [gameId, router]));

  // ── Redirect guards ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!game) return;
    if (game.state === GameState.WAITING) router.replace(`/lobby/${gameId}`);
    if (
      game.state === GameState.FLAGGING ||
      game.state === GameState.SCORING  ||
      game.state === GameState.COMPLETE
    ) {
      router.replace(`/results/${gameId}`);
    }
  }, [game, gameId, router]);

  // ── Active player count ────────────────────────────────────────────────────
  // Fall back to roundData.activePlayerCount while playerList is still empty
  // (players auto-register on commitAnswers, so playerCount starts at 0)
  const activeCount = useMemo(() => {
    const fromList = playerList.filter((p) => p.isActive).length;
    if (fromList > 0) return fromList;
    return roundData?.activePlayerCount ?? 0;
  }, [playerList, roundData]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (!game) {
    return (
      <div className="min-h-screen bg-[#0F0F0F] flex items-center justify-center">
        <Loading03Icon size={24} className="animate-spin text-[#9B9B9B]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F]">

      {/* ── Letter Reveal Overlay ──────────────────────────────────────────── */}
      <AnimatePresence>
        {showLetterReveal && (
          <LetterReveal
            letter={revealLetter}
            round={game.currentRound}
            onComplete={() => setShowLetterReveal(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Nav ───────────────────────────────────────────────────────────── */}
      <nav className="border-b border-[#2D2D2D] sticky top-0 z-40 bg-[#0F0F0F]/95 backdrop-blur-sm">
        <div className="game-container flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <button onClick={() => router.push("/")} className="btn-icon">
              <GameController01Icon size={18} className="text-[#008751]" />
            </button>
            <span className="text-[#2D2D2D]">/</span>
            <span className="text-sm text-[#9B9B9B]">Game</span>
            <span className="text-[#2D2D2D]">/</span>
            <span className="text-sm font-mono text-white">#{gameId.toString()}</span>
            <span className="hidden sm:block text-xs text-[#9B9B9B] ml-1">
              · {roundLabel(game.currentRound)}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Timer in nav for mobile */}
            {phase.activeDeadline && (
              <div className="flex items-center gap-1.5 sm:hidden">
                <Timer01Icon size={14} className="text-[#9B9B9B]" />
                <CountdownTimer
                  deadline={phase.activeDeadline}
                  compact
                />
              </div>
            )}
            <ConnectButton accountStatus="avatar" chainStatus="none" showBalance={false} />
          </div>
        </div>
      </nav>

      <main className="game-container py-6 space-y-5">

        {/* ── Phase banner ──────────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          <PhaseBanner
            key={phase.state}
            state={phase.state}
            round={game.currentRound}
          />
        </AnimatePresence>

        {/* ── Timer + letter row ────────────────────────────────────────────── */}
        {phase.activeDeadline && (
          <div className="hidden sm:flex items-center justify-between card px-5 py-3">
            <div className="flex items-center gap-2 text-[#9B9B9B] text-sm">
              <Timer01Icon size={16} />
              <span>Time remaining</span>
            </div>
            <CountdownTimer deadline={phase.activeDeadline} />
          </div>
        )}

        {/* ── Letter display (during commit) ────────────────────────────────── */}
        {(phase.state === GameState.COMMIT || phase.state === GameState.REVEAL) && letter !== "?" && (
          <div className="card px-5 py-4 flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="label">Round letter</p>
              <p className="text-sm text-[#9B9B9B]">All answers must start with:</p>
            </div>
            <div className="w-14 h-14 rounded-[8px] bg-[#008751]/10 border border-[#008751]/30 flex items-center justify-center">
              <span className="text-3xl font-bold text-[#008751]">{letter}</span>
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/*                        COMMIT PHASE                                 */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {phase.state === GameState.COMMIT && (
          <div className="space-y-4">

            {/* Progress */}
            <div className="card px-5 py-4">
              <CommitProgress committed={liveCommitCount} total={activeCount} />
            </div>

            {/* Answer form — for any connected player who hasn't committed yet
                (auto-registration happens on first commitAnswers tx) */}
            {isConnected && !myStatus.hasCommitted && (!myStatus.isInGame || myStatus.isActive) && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <AnswerForm
                  letter={letter}
                  onSubmit={(answers) => commitAnswers.execute(answers)}
                  isPending={commitAnswers.isPending || commitAnswers.isConfirming}
                  error={commitAnswers.error}
                  commitDeadline={phase.activeDeadline ? Number(phase.activeDeadline) : undefined}
                  deadlinePassed={phase.deadlinePassed}
                />
              </motion.div>
            )}

            {/* Already committed — show locked-in answers */}
            {myStatus.hasCommitted && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="card px-5 py-4 space-y-3"
              >
                {/* Header */}
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#008751]/10 flex items-center justify-center shrink-0">
                    <SquareLockPasswordIcon size={16} className="text-[#008751]" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">Answers locked in!</p>
                    <p className="text-xs text-[#9B9B9B] mt-0.5">Waiting for reveal phase…</p>
                  </div>
                  <CheckmarkCircle01Icon size={20} className="text-[#008751] shrink-0" />
                </div>

                {/* Show the saved answers */}
                {revealAnswers.savedAnswers && (
                  <>
                    <div className="divider" />
                    <div className="space-y-2">
                      {["Person", "Place", "Thing", "Animal", "Food"].map((cat, i) => (
                        <div key={cat} className="flex items-center gap-3">
                          <span className="text-xs text-[#9B9B9B] w-14 shrink-0">{cat}</span>
                          <span className={cn(
                            "text-sm font-medium flex-1",
                            revealAnswers.savedAnswers![i] ? "text-white" : "text-[#9B9B9B] italic"
                          )}>
                            {revealAnswers.savedAnswers![i] || "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {/* Window closed, not committed */}
            {phase.deadlinePassed && !myStatus.hasCommitted && isConnected &&
             !commitAnswers.isPending && !commitAnswers.isConfirming && (
              <div className="flex items-center gap-3 px-5 py-4 card">
                <InformationCircleIcon size={16} className="text-[#9B9B9B] shrink-0" />
                <p className="text-sm text-[#9B9B9B]">
                  Commit window closed. You won't score points this round.
                </p>
              </div>
            )}

            {/* Admin: reveal phase auto-advancing */}
            {myStatus.isAdmin && phase.deadlinePassed && (openReveal.isPending || openReveal.isConfirming) && (
              <div className="flex items-center gap-3 px-5 py-4 card">
                <span className="w-4 h-4 border-2 border-[#DFAB01]/30 border-t-[#DFAB01] rounded-full animate-spin shrink-0" />
                <p className="text-sm text-[#9B9B9B]">
                  {openReveal.isConfirming ? "Opening reveal phase on-chain…" : "Confirm in wallet — opening reveal phase"}
                </p>
              </div>
            )}
            {openReveal.error && myStatus.isAdmin && (
              <p className="text-xs text-[#E03E3E] px-1">{openReveal.error}</p>
            )}
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/*                        REVEAL PHASE                                 */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {phase.state === GameState.REVEAL && (
          <div className="space-y-4">

            {/* Progress */}
            <div className="card px-5 py-4">
              <RevealProgress revealed={liveRevealCount} total={activeCount} />
            </div>

            {/* Auto-reveal status */}
            {myStatus.isInGame && myStatus.isActive && myStatus.hasCommitted && !myStatus.hasRevealed && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="card px-5 py-4 space-y-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#DFAB01]/10 flex items-center justify-center shrink-0">
                    {revealAnswers.isPending || revealAnswers.isConfirming
                      ? <span className="w-4 h-4 border-2 border-[#DFAB01]/30 border-t-[#DFAB01] rounded-full animate-spin" />
                      : <EyeIcon size={16} className="text-[#DFAB01]" />
                    }
                  </div>
                  <div className="flex-1">
                    {revealAnswers.isPending
                      ? <><p className="text-sm font-medium text-white">Approve reveal in wallet</p>
                          <p className="text-xs text-[#9B9B9B] mt-0.5">Check your wallet for a signature request</p></>
                      : revealAnswers.isConfirming
                      ? <><p className="text-sm font-medium text-white">Revealing answers on-chain…</p>
                          <p className="text-xs text-[#9B9B9B] mt-0.5">Confirming transaction</p></>
                      : <><p className="text-sm font-medium text-white">Waiting for reveal phase</p>
                          <p className="text-xs text-[#9B9B9B] mt-0.5">Answers will be revealed automatically</p></>
                    }
                  </div>
                </div>
                {/* Show the locked-in answers */}
                {revealAnswers.savedAnswers && (
                  <>
                    <div className="divider" />
                    <div className="space-y-2">
                      {["Person", "Place", "Thing", "Animal", "Food"].map((cat, i) => (
                        <div key={cat} className="flex items-center gap-3">
                          <span className="text-xs text-[#9B9B9B] w-14 shrink-0">{cat}</span>
                          <span className={cn("text-sm font-medium flex-1",
                            revealAnswers.savedAnswers![i] ? "text-white" : "text-[#9B9B9B] italic"
                          )}>
                            {revealAnswers.savedAnswers![i] || "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {revealAnswers.error && (
                  <p className="text-xs text-[#E03E3E]">{revealAnswers.error}</p>
                )}
              </motion.div>
            )}

            {/* Already revealed */}
            {myStatus.hasRevealed && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-3 px-5 py-4 card"
              >
                <div className="w-8 h-8 rounded-full bg-[#0F7B6C]/10 flex items-center justify-center shrink-0">
                  <CheckmarkCircle01Icon size={16} className="text-[#0F7B6C]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Answers revealed!</p>
                  <p className="text-xs text-[#9B9B9B] mt-0.5">
                    Waiting for flagging phase to open.
                  </p>
                </div>
              </motion.div>
            )}

            {/* Didn't commit — spectating */}
            {myStatus.isInGame && !myStatus.hasCommitted && (
              <div className="flex items-center gap-3 px-5 py-4 card">
                <InformationCircleIcon size={16} className="text-[#9B9B9B] shrink-0" />
                <p className="text-sm text-[#9B9B9B]">
                  You didn't commit answers this round.
                </p>
              </div>
            )}

            {/* Admin: flagging phase auto-advancing */}
            {myStatus.isAdmin && phase.deadlinePassed && (openFlagging.isPending || openFlagging.isConfirming) && (
              <div className="flex items-center gap-3 px-5 py-4 card">
                <span className="w-4 h-4 border-2 border-[#DFAB01]/30 border-t-[#DFAB01] rounded-full animate-spin shrink-0" />
                <p className="text-sm text-[#9B9B9B]">
                  {openFlagging.isConfirming ? "Opening flagging phase on-chain…" : "Confirm in wallet — opening flagging phase"}
                </p>
              </div>
            )}
            {openFlagging.error && myStatus.isAdmin && (
              <p className="text-xs text-[#E03E3E] px-1">{openFlagging.error}</p>
            )}
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/*                       FLAGGING PHASE                                */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {phase.state === GameState.FLAGGING && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 px-4 py-3 rounded-[8px] bg-[#E03E3E]/10 border border-[#E03E3E]/20 text-sm text-[#E03E3E]">
              <InformationCircleIcon size={14} className="shrink-0" />
              <span>
                Review answers. Flag anything that doesn't start with <strong>{letter}</strong> or is invalid.
                50%+ flags = 0 pts.
              </span>
            </div>

            {/* Flagging UI lives in results page (full answer grid) */}
            <div className="card px-5 py-4 flex items-center gap-3">
              <InformationCircleIcon size={16} className="text-[#9B9B9B] shrink-0" />
              <p className="text-sm text-[#9B9B9B]">
                Full flagging interface is on the{" "}
                <button
                  onClick={() => router.push(`/results/${gameId}`)}
                  className="text-white underline underline-offset-2"
                >
                  results page
                </button>
              </p>
              <button
                onClick={() => router.push(`/results/${gameId}`)}
                className="btn-secondary ml-auto shrink-0 text-xs"
              >
                Go <ArrowRight01Icon size={14} />
              </button>
            </div>

            {/* Admin: score round auto-advancing (shown only if somehow still on this page) */}
            {myStatus.isAdmin && phase.deadlinePassed && (scoreRound.isPending || scoreRound.isConfirming) && (
              <div className="flex items-center gap-3 px-5 py-4 card">
                <span className="w-4 h-4 border-2 border-[#DFAB01]/30 border-t-[#DFAB01] rounded-full animate-spin shrink-0" />
                <p className="text-sm text-[#9B9B9B]">
                  {scoreRound.isConfirming ? "Scoring round on-chain…" : "Confirm in wallet — scoring round"}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/*                        SCORING PHASE                                */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {phase.state === GameState.SCORING && (
          <div className="card px-5 py-8 flex flex-col items-center gap-4 text-center">
            <Loading03Icon size={32} className="animate-spin text-[#008751]" />
            <div>
              <p className="text-white font-medium">Calculating scores…</p>
              <p className="text-sm text-[#9B9B9B] mt-1">
                Results will be ready shortly.
              </p>
            </div>
          </div>
        )}

        {/* ── Player list ───────────────────────────────────────────────────── */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="label flex items-center gap-1.5">
              <UserGroupIcon size={12} />
              Players ({activeCount} active)
            </h2>
            <span className="text-xs text-[#9B9B9B]">
              {playerList.length - activeCount} eliminated
            </span>
          </div>
          <PlayerList
            players={playerList}
            myAddress={address}
            gameId={gameId}
            round={game.currentRound}
            showCommitStatus={phase.state === GameState.COMMIT}
            showRevealStatus={phase.state === GameState.REVEAL || phase.state === GameState.FLAGGING}
          />
        </section>

        {/* ── Not in game notice (eliminated only) ─────────────────────────── */}

        {/* ── Eliminated notice ─────────────────────────────────────────────── */}
        {myStatus.isInGame && !myStatus.isActive && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-[8px] bg-[#E03E3E]/10 border border-[#E03E3E]/20 text-sm text-[#E03E3E]">
            <InformationCircleIcon size={16} className="shrink-0" />
            <span>You've been eliminated. Watch the rest of the game!</span>
          </div>
        )}

      </main>
    </div>
  );
}
