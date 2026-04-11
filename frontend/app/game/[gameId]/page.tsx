"use client";

import {
  ArrowRight01Icon,
  CheckmarkCircle01Icon,
  CrownIcon,
  EyeIcon,
  GameController01Icon,
  InformationCircleIcon,
  Loading03Icon,
  SquareLockPasswordIcon,
  Timer01Icon,
  Copy01Icon,
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
    // Navigate to results when scoring/complete
    if (event.newState === GameState.SCORING || event.newState === GameState.COMPLETE) {
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
    if (game.state === GameState.SCORING || game.state === GameState.COMPLETE) {
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

  // ── Admin: can advance phase ───────────────────────────────────────────────
  const canOpenReveal   = myStatus.isAdmin && phase.state === GameState.COMMIT   && phase.deadlinePassed;
  const canOpenFlagging = myStatus.isAdmin && phase.state === GameState.REVEAL   && phase.deadlinePassed;
  const canScoreRound   = myStatus.isAdmin && phase.state === GameState.FLAGGING && phase.deadlinePassed;

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
              <AnimatePresence>
                {(!phase.deadlinePassed || commitAnswers.isPending || commitAnswers.isConfirming) && (
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
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            )}

            {/* Already committed */}
            {myStatus.hasCommitted && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-3 px-5 py-4 card"
              >
                <div className="w-8 h-8 rounded-full bg-[#008751]/10 flex items-center justify-center shrink-0">
                  <SquareLockPasswordIcon size={16} className="text-[#008751]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Answers locked in!</p>
                  <p className="text-xs text-[#9B9B9B] mt-0.5">
                    Wait for the reveal phase to show your answers.
                    {/* Monad's fast finality means this transition is nearly instant */}
                  </p>
                </div>
                <CheckmarkCircle01Icon size={20} className="text-[#008751] ml-auto shrink-0" />
              </motion.div>
            )}

            {/* Window closed, not committed */}
            {phase.deadlinePassed && !myStatus.hasCommitted && isConnected && (
              <div className="flex items-center gap-3 px-5 py-4 card">
                <InformationCircleIcon size={16} className="text-[#9B9B9B] shrink-0" />
                <p className="text-sm text-[#9B9B9B]">
                  Commit window closed. You won't score points this round.
                </p>
              </div>
            )}

            {/* Admin: open reveal */}
            {canOpenReveal && (
              <div className="card px-5 py-4 space-y-3">
                <div className="flex items-center gap-2">
                  <CrownIcon size={14} className="text-[#DFAB01]" />
                  <span className="text-sm font-medium text-white">Admin — Open Reveal Phase</span>
                </div>
                <button
                  onClick={() => openReveal.execute()}
                  disabled={openReveal.isPending || openReveal.isConfirming}
                  className="btn-primary w-full"
                >
                  {openReveal.isPending || openReveal.isConfirming ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {openReveal.isConfirming ? "Confirming…" : "Confirm in wallet…"}
                    </>
                  ) : (
                    <>
                      <EyeIcon size={16} />
                      Open Reveal Phase
                      <ArrowRight01Icon size={16} />
                    </>
                  )}
                </button>
                {openReveal.error && (
                  <p className="text-xs text-[#E03E3E]">{openReveal.error}</p>
                )}
              </div>
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

            {/* Reveal CTA */}
            {myStatus.isInGame && myStatus.isActive && myStatus.hasCommitted && !myStatus.hasRevealed && (
              <AnimatePresence>
                {!phase.deadlinePassed && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="card px-5 py-5 space-y-4"
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-white">Your committed answers</p>
                      <p className="text-xs text-[#9B9B9B]">
                        These are the answers you locked in. Click reveal to publish them.
                      </p>
                    </div>

                    {/* Show saved answers */}
                    {revealAnswers.savedAnswers && (
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
                    )}

                    <button
                      onClick={() => revealAnswers.execute()}
                      disabled={revealAnswers.isPending || revealAnswers.isConfirming}
                      className="btn-primary w-full"
                    >
                      {revealAnswers.isPending ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Confirm in wallet…
                        </>
                      ) : revealAnswers.isConfirming ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Revealing…
                        </>
                      ) : (
                        <>
                          <EyeIcon size={16} />
                          Reveal My Answers
                        </>
                      )}
                    </button>

                    {revealAnswers.error && (
                      <p className="text-xs text-[#E03E3E]">{revealAnswers.error}</p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
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

            {/* Admin: open flagging */}
            {canOpenFlagging && (
              <div className="card px-5 py-4 space-y-3">
                <div className="flex items-center gap-2">
                  <CrownIcon size={14} className="text-[#DFAB01]" />
                  <span className="text-sm font-medium text-white">Admin — Open Flagging Phase</span>
                </div>
                <button
                  onClick={() => openFlagging.execute()}
                  disabled={openFlagging.isPending || openFlagging.isConfirming}
                  className="btn-primary w-full"
                >
                  {openFlagging.isPending || openFlagging.isConfirming ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {openFlagging.isConfirming ? "Confirming…" : "Confirm in wallet…"}
                    </>
                  ) : (
                    <>Open Flagging Phase <ArrowRight01Icon size={16} /></>
                  )}
                </button>
                {openFlagging.error && (
                  <p className="text-xs text-[#E03E3E]">{openFlagging.error}</p>
                )}
              </div>
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

            {/* Admin: score round */}
            {canScoreRound && (
              <div className="card px-5 py-4 space-y-3">
                <div className="flex items-center gap-2">
                  <CrownIcon size={14} className="text-[#DFAB01]" />
                  <span className="text-sm font-medium text-white">Admin — Score Round</span>
                </div>
                <button
                  onClick={() => scoreRound.execute()}
                  disabled={scoreRound.isPending || scoreRound.isConfirming}
                  className="btn-primary w-full"
                >
                  {scoreRound.isPending || scoreRound.isConfirming ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {scoreRound.isConfirming ? "Scoring…" : "Confirm in wallet…"}
                    </>
                  ) : (
                    <>
                      <Copy01Icon size={16} />
                      Score Round & Advance
                      <ArrowRight01Icon size={16} />
                    </>
                  )}
                </button>
                {scoreRound.error && (
                  <p className="text-xs text-[#E03E3E]">{scoreRound.error}</p>
                )}
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
