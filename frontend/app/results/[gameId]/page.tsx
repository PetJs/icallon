"use client";

import {
  ArrowRight01Icon,
  CrownIcon,
  Flag01Icon,
  GameController01Icon,
  InformationCircleIcon,
  Loading03Icon,
  Tick01Icon,
  Timer01Icon,
  Award01Icon,
  UserGroupIcon,
} from "@hugeicons/react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { AnimatePresence, motion } from "framer-motion";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import FlagButton from "@/components/game/FlagButton";
import ScoreBoard from "@/components/game/ScoreBoard";
import CountdownTimer from "@/components/game/CountdownTimer";
import {
  useAllPlayerData,
  useAllRevealedAnswers,
  useGameData,
  useGamePhase,
  useMyGameStatus,
  useOpenFlagging,
  useRoundData,
  useRoundLetter,
  useScoreRound,
  useStartRound,
} from "@/hooks/useICallOn";
import {
  useOnAnswerFlagged,
  useOnGameComplete,
  useOnPhaseAdvanced,
  useOnRoundScored,
  useOnRoundStarted,
} from "@/hooks/useGameEvents";
import { CATEGORY_LABELS, Category, GameState } from "@/lib/contract";
import {
  cn,
  formatAddress,
  formatMON,
  roundLabel,
} from "@/lib/utils";

// ── Category column header ────────────────────────────────────────────────────
const CATEGORY_LIST = [
  Category.PERSON,
  Category.PLACE,
  Category.THING,
  Category.ANIMAL,
  Category.FOOD,
] as const;

// ── Single answer cell in the grid ───────────────────────────────────────────
function AnswerCell({
  answer,
  playerAddr,
  category,
  gameId,
  round,
  activeCount,
  canFlag,
  myAddress,
}: {
  answer:      string;
  playerAddr:  `0x${string}`;
  category:    Category;
  gameId:      bigint;
  round:       number;
  activeCount: number;
  canFlag:     boolean;
  myAddress:   `0x${string}` | undefined;
}) {
  const isOwn = myAddress?.toLowerCase() === playerAddr.toLowerCase();

  return (
    <div className="flex items-center justify-between gap-2 min-h-[32px]">
      <span className={cn(
        "text-sm truncate flex-1",
        !answer         && "text-[#9B9B9B] italic",
        answer && isOwn && "text-white font-medium",
        answer && !isOwn && "text-[#9B9B9B]",
      )}>
        {answer || "—"}
      </span>

      {answer && canFlag && !isOwn && (
        <FlagButton
          gameId={gameId}
          round={round}
          flaggedPlayer={playerAddr}
          category={category}
          activeCount={activeCount}
        />
      )}
    </div>
  );
}

// ── Winner celebration card ───────────────────────────────────────────────────
function WinnerCard({
  winner,
  prize,
  isYou,
}: {
  winner: `0x${string}`;
  prize:  bigint;
  isYou:  boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 8 }}
      animate={{ opacity: 1, scale: 1,    y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={cn(
        "card p-6 text-center space-y-4 border",
        isYou
          ? "border-[#DFAB01]/50 bg-[#DFAB01]/5"
          : "border-[#008751]/30 bg-[#008751]/5"
      )}
    >
      <div className="flex justify-center">
        <div className={cn(
          "w-16 h-16 rounded-full flex items-center justify-center",
          isYou ? "bg-[#DFAB01]/20" : "bg-[#008751]/20"
        )}>
          <Award01Icon size={32} className={isYou ? "text-[#DFAB01]" : "text-[#008751]"} />
        </div>
      </div>

      {isYou ? (
        <>
          <div>
            <p className="text-xl font-bold text-[#DFAB01]">You won! 🇳🇬</p>
            <p className="text-sm text-[#9B9B9B] mt-1">
              {formatMON(prize)} has been sent to your wallet
            </p>
          </div>
          <p className="text-xs text-[#9B9B9B] font-mono">{winner}</p>
        </>
      ) : (
        <>
          <div>
            <p className="text-lg font-bold text-white">Winner</p>
            <p className="text-sm font-mono text-[#008751] mt-1">
              {formatAddress(winner, 6)}
            </p>
          </div>
          <p className="text-sm text-[#9B9B9B]">
            {formatMON(prize)} prize collected
          </p>
        </>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//                           MAIN RESULTS PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function ResultsPage() {
  const params = useParams();
  const router = useRouter();
  const gameId = BigInt(params.gameId as string);

  const { address } = useAccount();

  // ── Contract reads ────────────────────────────────────────────────────────
  const { game, refetch: refetchGame }                      = useGameData(gameId);
  const { roundData, refetch: refetchRound }                = useRoundData(gameId);
  const { letter }                                           = useRoundLetter(gameId);
  const phase                                                = useGamePhase(gameId);
  const myStatus                                             = useMyGameStatus(gameId);
  const { playerList, refetch: refetchPlayers }             = useAllPlayerData(gameId, game?.playerCount ?? 0);

  const activePlayers = useMemo(
    () => playerList.filter((p) => p.isActive).map((p) => p.addr),
    [playerList]
  );

  const { answersMap, refetch: refetchAnswers } = useAllRevealedAnswers(
    gameId,
    game?.currentRound,
    activePlayers
  );

  // ── Write hooks (admin) ───────────────────────────────────────────────────
  const openFlagging = useOpenFlagging(gameId);
  const scoreRound   = useScoreRound(gameId);
  const startRound   = useStartRound(gameId);

  // ── Live flag updates ─────────────────────────────────────────────────────
  const [flagBump, setFlagBump] = useState(0); // trigger re-render on flag event

  useOnAnswerFlagged(gameId, useCallback(() => {
    setFlagBump((n) => n + 1);
  }, []));

  // ── Phase transitions ──────────────────────────────────────────────────────
  useOnPhaseAdvanced(gameId, useCallback((event) => {
    refetchGame();
    refetchRound();
    refetchPlayers();
    refetchAnswers();
  }, [refetchGame, refetchRound, refetchPlayers, refetchAnswers]));

  // Round started → navigate back to game page
  useOnRoundStarted(gameId, useCallback(() => {
    router.push(`/game/${gameId}`);
  }, [gameId, router]));

  useOnRoundScored(gameId, useCallback(() => {
    refetchGame();
    refetchPlayers();
  }, [refetchGame, refetchPlayers]));

  useOnGameComplete(gameId, useCallback(() => {
    refetchGame();
  }, [refetchGame]));

  // ── Derived state ─────────────────────────────────────────────────────────
  const activeCount = activePlayers.length;
  const isComplete  = game?.state === GameState.COMPLETE;
  const isFlagging  = game?.state === GameState.FLAGGING;
  const isScoring   = game?.state === GameState.SCORING;

  const canOpenFlagging = myStatus.isAdmin && phase.state === GameState.REVEAL   && phase.deadlinePassed;
  const canScoreRound   = myStatus.isAdmin && phase.state === GameState.FLAGGING && phase.deadlinePassed;
  const canStartNext    = myStatus.isAdmin && phase.state === GameState.SCORING;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (!game) {
    return (
      <div className="min-h-screen bg-[#0F0F0F] flex items-center justify-center">
        <Loading03Icon size={24} className="animate-spin text-[#9B9B9B]" />
      </div>
    );
  }

  const round       = game.currentRound;
  const isMyWin     = isComplete && !!game.winner && !!address &&
    game.winner.toLowerCase() === address.toLowerCase();

  return (
    <div className="min-h-screen bg-[#0F0F0F]">

      {/* ── Nav ───────────────────────────────────────────────────────────── */}
      <nav className="border-b border-[#2D2D2D] sticky top-0 z-40 bg-[#0F0F0F]/95 backdrop-blur-sm">
        <div className="game-container flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <button onClick={() => router.push("/")} className="btn-icon">
              <GameController01Icon size={18} className="text-[#008751]" />
            </button>
            <span className="text-[#2D2D2D]">/</span>
            <span className="text-sm text-[#9B9B9B]">Results</span>
            <span className="text-[#2D2D2D]">/</span>
            <span className="text-sm font-mono text-white">#{gameId.toString()}</span>
          </div>
          <div className="flex items-center gap-3">
            {phase.activeDeadline && isFlagging && (
              <div className="flex items-center gap-1.5">
                <Flag01Icon size={14} className="text-[#E03E3E]" />
                <CountdownTimer deadline={phase.activeDeadline} compact />
              </div>
            )}
            <ConnectButton accountStatus="avatar" chainStatus="none" showBalance={false} />
          </div>
        </div>
      </nav>

      <main className="game-container py-6 space-y-6">

        {/* ── Winner screen ──────────────────────────────────────────────── */}
        {isComplete && game.winner && (
          <WinnerCard
            winner={game.winner}
            prize={game.prizePool > 0n ? game.prizePool : 0n}
            isYou={isMyWin}
          />
        )}

        {/* ── Round header ──────────────────────────────────────────────── */}
        {!isComplete && (
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-xl font-bold text-white">
                {roundLabel(round)}
              </h1>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#9B9B9B]">Letter</span>
                <span className="text-sm font-bold text-[#008751]">{letter}</span>
                <span className="text-[#2D2D2D]">·</span>
                <span className="text-sm text-[#9B9B9B]">
                  {activeCount} player{activeCount !== 1 ? "s" : ""} remain
                </span>
              </div>
            </div>

            {/* Flagging timer */}
            {isFlagging && phase.activeDeadline && (
              <div className="hidden sm:flex items-center gap-2 card px-4 py-2">
                <Timer01Icon size={14} className="text-[#E03E3E]" />
                <CountdownTimer deadline={phase.activeDeadline} />
              </div>
            )}
          </div>
        )}

        {/* ── Phase status banners ───────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {isFlagging && (
            <motion.div
              key="flagging"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-3 px-4 py-3 rounded-[8px] bg-[#E03E3E]/10 border border-[#E03E3E]/20 text-sm text-[#E03E3E]"
            >
              <Flag01Icon size={14} className="shrink-0" />
              <span>
                <strong>Flagging phase open.</strong> Review answers below.
                Flag anything invalid — 50%+ flags = 0 pts for that answer.
              </span>
            </motion.div>
          )}

          {isScoring && (
            <motion.div
              key="scoring"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 px-4 py-3 rounded-[8px] bg-[#1A1A1A] border border-[#2D2D2D] text-sm text-[#9B9B9B]"
            >
              <Loading03Icon size={14} className="animate-spin shrink-0" />
              <span>Scores calculated — waiting for next round.</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Admin controls ─────────────────────────────────────────────── */}
        {(canOpenFlagging || canScoreRound || canStartNext) && (
          <div className="card px-5 py-4 space-y-3">
            <div className="flex items-center gap-2">
              <CrownIcon size={14} className="text-[#DFAB01]" />
              <span className="text-sm font-medium text-white">Admin Controls</span>
            </div>

            {canOpenFlagging && (
              <div className="space-y-2">
                <p className="text-xs text-[#9B9B9B]">Reveal phase ended. Open flagging window.</p>
                <button
                  onClick={() => openFlagging.execute()}
                  disabled={openFlagging.isPending || openFlagging.isConfirming}
                  className="btn-primary w-full"
                >
                  {openFlagging.isPending || openFlagging.isConfirming ? (
                    <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {openFlagging.isConfirming ? "Confirming…" : "Confirm in wallet…"}
                    </>
                  ) : (
                    <><Flag01Icon size={16} /> Open Flagging Phase <ArrowRight01Icon size={16} /></>
                  )}
                </button>
                {openFlagging.error && <p className="text-xs text-[#E03E3E]">{openFlagging.error}</p>}
              </div>
            )}

            {canScoreRound && (
              <div className="space-y-2">
                <p className="text-xs text-[#9B9B9B]">Flagging window closed. Calculate scores.</p>
                <button
                  onClick={() => scoreRound.execute()}
                  disabled={scoreRound.isPending || scoreRound.isConfirming}
                  className="btn-primary w-full"
                >
                  {scoreRound.isPending || scoreRound.isConfirming ? (
                    <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {scoreRound.isConfirming ? "Scoring on-chain…" : "Confirm in wallet…"}
                    </>
                  ) : (
                    <><Award01Icon size={16} /> Score Round &amp; Eliminate <ArrowRight01Icon size={16} /></>
                  )}
                </button>
                {scoreRound.error && <p className="text-xs text-[#E03E3E]">{scoreRound.error}</p>}
              </div>
            )}

            {canStartNext && !isComplete && (
              <div className="space-y-2">
                <p className="text-xs text-[#9B9B9B]">
                  Round {round} complete. Start round {round + 1}.
                </p>
                <button
                  onClick={() => startRound.execute()}
                  disabled={startRound.isPending || startRound.isConfirming}
                  className="btn-primary w-full"
                >
                  {startRound.isPending || startRound.isConfirming ? (
                    <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {startRound.isConfirming ? "Starting…" : "Confirm in wallet…"}
                    </>
                  ) : (
                    <>Start Round {round + 1} <ArrowRight01Icon size={16} /></>
                  )}
                </button>
                {startRound.error && <p className="text-xs text-[#E03E3E]">{startRound.error}</p>}
              </div>
            )}
          </div>
        )}

        {/* ── Answer grid (flagging + reveal) ───────────────────────────── */}
        {answersMap.size > 0 && (
          <section className="space-y-3">
            <h2 className="label flex items-center gap-1.5">
              <Flag01Icon size={12} />
              Answers — Round {round}
            </h2>

            {/* Desktop: full grid table */}
            <div className="hidden sm:block card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#2D2D2D]">
                      <th className="text-left px-4 py-2.5 text-[#9B9B9B] font-medium text-xs w-36">
                        Player
                      </th>
                      {CATEGORY_LIST.map((cat) => (
                        <th key={cat} className="text-left px-3 py-2.5 text-[#9B9B9B] font-medium text-xs">
                          {CATEGORY_LABELS[cat]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2D2D2D]">
                    {activePlayers.map((addr) => {
                      const answers = answersMap.get(addr);
                      if (!answers) return null;
                      const isYou = address?.toLowerCase() === addr.toLowerCase();

                      return (
                        <tr
                          key={addr}
                          className={cn(
                            "transition-colors duration-150",
                            isYou ? "bg-[#008751]/5" : "hover:bg-[#2D2D2D]/30"
                          )}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "font-mono text-xs",
                                isYou ? "text-[#008751]" : "text-[#9B9B9B]"
                              )}>
                                {formatAddress(addr, 4)}
                              </span>
                              {isYou && (
                                <span className="text-[10px] text-[#008751] border border-[#008751]/30 rounded px-1">
                                  You
                                </span>
                              )}
                            </div>
                          </td>
                          {CATEGORY_LIST.map((cat) => (
                            <td key={cat} className="px-3 py-2.5">
                              <AnswerCell
                                answer={answers[cat]}
                                playerAddr={addr}
                                category={cat}
                                gameId={gameId}
                                round={round}
                                activeCount={activeCount}
                                canFlag={myStatus.canFlag}
                                myAddress={address}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile: card-per-player */}
            <div className="sm:hidden space-y-3">
              {activePlayers.map((addr) => {
                const answers = answersMap.get(addr);
                if (!answers) return null;
                const isYou = address?.toLowerCase() === addr.toLowerCase();

                return (
                  <div
                    key={addr}
                    className={cn(
                      "card p-4 space-y-3",
                      isYou && "border-[#008751]/30"
                    )}
                  >
                    {/* Player header */}
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "font-mono text-xs",
                        isYou ? "text-[#008751]" : "text-[#9B9B9B]"
                      )}>
                        {formatAddress(addr, 5)}
                      </span>
                      {isYou && (
                        <span className="text-[10px] text-[#008751] border border-[#008751]/30 rounded px-1">
                          You
                        </span>
                      )}
                    </div>

                    {/* Answers */}
                    <div className="space-y-2 divide-y divide-[#2D2D2D]">
                      {CATEGORY_LIST.map((cat) => (
                        <div key={cat} className="flex items-center gap-3 pt-2 first:pt-0">
                          <span className="text-xs text-[#9B9B9B] w-14 shrink-0">
                            {CATEGORY_LABELS[cat]}
                          </span>
                          <AnswerCell
                            answer={answers[cat]}
                            playerAddr={addr}
                            category={cat}
                            gameId={gameId}
                            round={round}
                            activeCount={activeCount}
                            canFlag={myStatus.canFlag}
                            myAddress={address}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Scoreboard ────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="label flex items-center gap-1.5">
            <Award01Icon size={12} />
            Scoreboard
          </h2>
          <ScoreBoard
            gameId={gameId}
            myAddress={address}
            showRoundScore={!isComplete}
          />
        </section>

        {/* ── Elimination summary (after scoring) ───────────────────────── */}
        {(isScoring || isComplete) && (
          <section className="space-y-3">
            <h2 className="label flex items-center gap-1.5">
              <UserGroupIcon size={12} />
              Round {round} Result
            </h2>
            <div className="card divide-y divide-[#2D2D2D]">
              {playerList.map((p) => (
                <div
                  key={p.addr}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <span className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    p.isActive ? "bg-[#008751]" : "bg-[#E03E3E]"
                  )} />
                  <span className={cn(
                    "font-mono text-sm flex-1",
                    p.isActive ? "text-white" : "text-[#9B9B9B] line-through"
                  )}>
                    {formatAddress(p.addr, 5)}
                    {p.addr.toLowerCase() === address?.toLowerCase() && (
                      <span className="ml-1.5 text-[10px] not-italic text-[#008751] no-underline">
                        (you)
                      </span>
                    )}
                  </span>
                  <span className={cn(
                    "text-sm font-medium",
                    p.isActive ? "text-white" : "text-[#9B9B9B]"
                  )}>
                    {p.roundScore.toString()} pts
                  </span>
                  {p.isActive ? (
                    <span className="text-[10px] text-[#008751] border border-[#008751]/30 rounded px-1.5 py-0.5">
                      Advances
                    </span>
                  ) : (
                    <span className="text-[10px] text-[#E03E3E] border border-[#E03E3E]/30 rounded px-1.5 py-0.5">
                      Eliminated
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Game complete — play again ─────────────────────────────────── */}
        {isComplete && (
          <div className="flex gap-3">
            <button
              onClick={() => router.push("/")}
              className="btn-primary flex-1"
            >
              Play Again
              <ArrowRight01Icon size={16} />
            </button>
            <button
              onClick={() => router.push(`/lobby/${gameId}`)}
              className="btn-secondary"
            >
              Lobby
            </button>
          </div>
        )}

        {/* ── Eliminated player notice ───────────────────────────────────── */}
        {myStatus.isInGame && !myStatus.isActive && !isComplete && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-[8px] bg-[#E03E3E]/10 border border-[#E03E3E]/20 text-sm text-[#E03E3E]">
            <InformationCircleIcon size={16} className="shrink-0" />
            <span>You've been eliminated. Watch until the final winner!</span>
          </div>
        )}

      </main>
    </div>
  );
}
