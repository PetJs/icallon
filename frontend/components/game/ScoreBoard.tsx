"use client";

/**
 * ScoreBoard.tsx — Live scoreboard table
 *
 * Renders a ranked list of all players sorted by:
 *   1. Active players first (eliminated pushed to bottom)
 *   2. Total score descending
 *   3. Round score descending (tiebreaker display only — on-chain uses commit timestamp)
 *
 * Score row colours follow the Notion design system:
 *   Unique answer   → #0F7B6C (success green)  — inferred when roundScore > 0 and no shared
 *   Shared answer   → #DFAB01 (warning yellow)
 *   Flagged/blank   → #E03E3E (danger red) / #9B9B9B (muted)
 *   Active player   → white text
 *   Eliminated      → strikethrough, muted
 *
 * The component does not know per-answer scoring status — it only has
 * the aggregate roundScore and totalScore. Colour coding is applied at
 * the row level based on score brackets, not per-answer.
 *
 * showRoundScore prop: true during active game (show this round's pts),
 * false on game-complete screen (show total only, with trophy for winner).
 */

import {
  Medal01Icon,
  Medal02Icon,
  Award01Icon,
} from "@hugeicons/react";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";

import { useLeaderboard } from "@/hooks/useICallOn";
import { GameState } from "@/lib/contract";
import { cn, formatAddress } from "@/lib/utils";

// ── Rank badge ────────────────────────────────────────────────────────────────
function RankBadge({ rank, isActive }: { rank: number; isActive: boolean }) {
  if (!isActive) {
    return (
      <span className="w-6 text-center text-xs text-[#9B9B9B] font-mono">
        —
      </span>
    );
  }

  if (rank === 1) {
    return <Award01Icon size={16} className="text-[#DFAB01] shrink-0" />;
  }
  if (rank === 2) {
    return <Medal01Icon size={16} className="text-[#9B9B9B] shrink-0" />;
  }
  if (rank === 3) {
    return <Medal02Icon size={16} className="text-[#CD7F32] shrink-0" />;
  }

  return (
    <span className="w-6 text-center text-xs text-[#9B9B9B] font-mono tabular-nums">
      {rank}
    </span>
  );
}

// ── Score pill ────────────────────────────────────────────────────────────────
function ScorePill({
  score,
  label,
  highlight,
}: {
  score:     bigint;
  label:     string;
  highlight: "green" | "yellow" | "muted";
}) {
  const colorClass = {
    green:  "text-[#0F7B6C] bg-[#0F7B6C]/10",
    yellow: "text-[#DFAB01] bg-[#DFAB01]/10",
    muted:  "text-[#9B9B9B] bg-transparent",
  }[highlight];

  return (
    <div className="text-right">
      <span className={cn(
        "text-sm font-semibold tabular-nums rounded px-1.5 py-0.5",
        colorClass
      )}>
        {score.toString()}
      </span>
      <p className="text-[10px] text-[#9B9B9B] mt-0.5">{label}</p>
    </div>
  );
}

// ── Single player row ─────────────────────────────────────────────────────────
function PlayerRow({
  rank,
  address,
  totalScore,
  roundScore,
  isActive,
  isYou,
  isWinner,
  showRoundScore,
  index,
}: {
  rank:           number;
  address:        `0x${string}`;
  totalScore:     bigint;
  roundScore:     bigint;
  isActive:       boolean;
  isYou:          boolean;
  isWinner:       boolean;
  showRoundScore: boolean;
  index:          number;
}) {
  // Determine score highlight for round score
  const roundHighlight: "green" | "yellow" | "muted" = useMemo(() => {
    if (!isActive || roundScore === 0n) return "muted";
    // High score likely means unique answers; lower means shared
    // Heuristic: multiples of 20 only = likely all unique
    if (roundScore % 20n === 0n && roundScore > 0n) return "green";
    return "yellow";
  }, [isActive, roundScore]);

  const totalHighlight: "green" | "yellow" | "muted" = useMemo(() => {
    if (!isActive) return "muted";
    if (isWinner)  return "green";
    if (totalScore > 60n) return "green";
    if (totalScore > 0n)  return "yellow";
    return "muted";
  }, [isActive, isWinner, totalScore]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition-colors duration-150",
        isYou    && "bg-[#008751]/5",
        isWinner && "bg-[#DFAB01]/5",
        !isActive && "opacity-50",
      )}
    >
      {/* Rank */}
      <div className="w-6 flex items-center justify-center shrink-0">
        <RankBadge rank={rank} isActive={isActive} />
      </div>

      {/* Avatar */}
      <div className={cn(
        "w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-mono font-bold",
        isWinner ? "bg-[#DFAB01]/20 text-[#DFAB01]"
        : isYou  ? "bg-[#008751]/20 text-[#008751]"
        : isActive ? "bg-[#2D2D2D] text-[#9B9B9B]"
        : "bg-[#1A1A1A] text-[#9B9B9B]"
      )}>
        {address.slice(2, 4).toUpperCase()}
      </div>

      {/* Address + badges */}
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className={cn(
          "font-mono text-sm truncate",
          isWinner  ? "text-[#DFAB01] font-medium"
          : isYou   ? "text-white font-medium"
          : isActive ? "text-[#9B9B9B]"
          : "text-[#9B9B9B] line-through",
        )}>
          {formatAddress(address, 4)}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          {isWinner && (
            <span className="text-[9px] font-bold text-[#DFAB01] border border-[#DFAB01]/40 rounded px-1 py-0.5 uppercase tracking-wide">
              Winner
            </span>
          )}
          {isYou && !isWinner && (
            <span className="text-[9px] font-medium text-[#008751] border border-[#008751]/30 rounded px-1 py-0.5">
              You
            </span>
          )}
          {!isActive && !isWinner && (
            <span className="text-[9px] text-[#E03E3E] border border-[#E03E3E]/30 rounded px-1 py-0.5">
              Out
            </span>
          )}
        </div>
      </div>

      {/* Scores */}
      <div className="flex items-center gap-4 shrink-0">
        {showRoundScore && (
          <ScorePill
            score={roundScore}
            label="round"
            highlight={roundHighlight}
          />
        )}
        <ScorePill
          score={totalScore}
          label="total"
          highlight={totalHighlight}
        />
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//                           MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
type ScoreBoardProps = {
  gameId:         bigint;
  myAddress:      `0x${string}` | undefined;
  /** Show the current round's score column (false on game-complete screen) */
  showRoundScore?: boolean;
  /** Winner address — highlights gold */
  winner?:        `0x${string}`;
  className?:     string;
};

export default function ScoreBoard({
  gameId,
  myAddress,
  showRoundScore = true,
  winner,
  className,
}: ScoreBoardProps) {
  const { leaderboard, isLoading } = useLeaderboard(gameId);

  if (isLoading && leaderboard.length === 0) {
    return (
      <div className={cn("card px-4 py-6 text-center text-sm text-[#9B9B9B]", className)}>
        Loading scores…
      </div>
    );
  }

  if (leaderboard.length === 0) {
    return (
      <div className={cn("card px-4 py-6 text-center text-sm text-[#9B9B9B]", className)}>
        No scores yet
      </div>
    );
  }

  const activeCount     = leaderboard.filter((e) => e.isActive).length;
  const eliminatedCount = leaderboard.length - activeCount;
  const topScore        = leaderboard[0]?.totalScore ?? 0n;

  return (
    <div className={cn("card overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2D2D2D]">
        <div className="flex items-center gap-2">
          <Award01Icon size={14} className="text-[#9B9B9B]" />
          <span className="text-xs font-medium text-[#9B9B9B] uppercase tracking-wider">
            Scoreboard
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-[#9B9B9B]">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#008751]" />
            {activeCount} active
          </span>
          {eliminatedCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E03E3E]" />
              {eliminatedCount} out
            </span>
          )}
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#2D2D2D]">
        <div className="w-6" /> {/* rank spacer */}
        <div className="w-7" /> {/* avatar spacer */}
        <div className="flex-1 text-[10px] text-[#9B9B9B] uppercase tracking-wider">
          Player
        </div>
        <div className="flex items-center gap-4 shrink-0">
          {showRoundScore && (
            <span className="text-[10px] text-[#9B9B9B] uppercase tracking-wider w-12 text-right">
              Round
            </span>
          )}
          <span className="text-[10px] text-[#9B9B9B] uppercase tracking-wider w-12 text-right">
            Total
          </span>
        </div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-[#2D2D2D]">
        <AnimatePresence mode="popLayout">
          {leaderboard.map((entry, i) => {
            const isWinner = !!winner &&
              entry.address.toLowerCase() === winner.toLowerCase();
            const isYou = !!myAddress &&
              entry.address.toLowerCase() === myAddress.toLowerCase();

            return (
              <PlayerRow
                key={entry.address}
                rank={entry.rank}
                address={entry.address}
                totalScore={entry.totalScore}
                roundScore={entry.roundScore}
                isActive={entry.isActive}
                isYou={isYou}
                isWinner={isWinner}
                showRoundScore={showRoundScore}
                index={i}
              />
            );
          })}
        </AnimatePresence>
      </div>

      {/* Summary footer */}
      {topScore > 0n && (
        <div className="border-t border-[#2D2D2D] px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs text-[#9B9B9B]">
            Top score
          </span>
          <span className="text-xs font-semibold text-[#0F7B6C] tabular-nums">
            {topScore.toString()} pts
          </span>
        </div>
      )}
    </div>
  );
}
