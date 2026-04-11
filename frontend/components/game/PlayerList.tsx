"use client";

/**
 * PlayerList.tsx — Compact player list for the game page sidebar
 *
 * Shown during active rounds (commit / reveal / flagging phases).
 * Displays each player as a Notion-style row with:
 *   - Status dot (active / eliminated)
 *   - Truncated wallet address
 *   - Commit status indicator (during commit phase)
 *   - Reveal status indicator (during reveal phase)
 *   - Round score (once revealed)
 *   - "You" badge for the connected wallet
 *
 * Deliberately compact — this lives below the main action area and
 * shouldn't distract from the form. Notion-style rows: no borders between
 * items, just tight padding and a subtle hover state.
 *
 * Props:
 *   players          — PlayerData[] from useAllPlayerData (all 16 slots)
 *   myAddress        — connected wallet address
 *   gameId           — for per-player commit/reveal reads
 *   round            — current round number
 *   showCommitStatus — true during COMMIT phase
 *   showRevealStatus — true during REVEAL + FLAGGING phases
 */

import {
  Clock01Icon,
  EyeIcon,
  SquareLockPasswordIcon,
  UserCircle02Icon,
} from "@hugeicons/react";
import { motion, AnimatePresence } from "framer-motion";
import { useMemo } from "react";

import { useReadContracts } from "wagmi";
import { CONTRACT } from "@/lib/contract";
import { type PlayerData } from "@/lib/contract";
import { cn, formatAddress } from "@/lib/utils";

// ── Status dot ────────────────────────────────────────────────────────────────
function StatusDot({ isActive }: { isActive: boolean }) {
  return (
    <span className={cn(
      "w-1.5 h-1.5 rounded-full shrink-0 mt-[1px]",
      isActive ? "bg-[#008751]" : "bg-[#E03E3E] opacity-50"
    )} />
  );
}

// ── Commit/reveal status icon ─────────────────────────────────────────────────
type ActionStatus = "pending" | "done" | "inactive";

function ActionIcon({
  status,
  type,
}: {
  status: ActionStatus;
  type:   "commit" | "reveal";
}) {
  if (status === "inactive") return null;

  if (status === "done") {
    const Icon = type === "commit" ? SquareLockPasswordIcon : EyeIcon;
    return (
      <motion.span
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
      >
        <Icon size={13} className="text-[#008751]" />
      </motion.span>
    );
  }

  // pending
  return <Clock01Icon size={13} className="text-[#2D2D2D]" />;
}

// ── Single player row ─────────────────────────────────────────────────────────
function PlayerRow({
  player,
  isYou,
  showCommitStatus,
  showRevealStatus,
  index,
}: {
  player:           PlayerData;
  isYou:            boolean;
  showCommitStatus: boolean;
  showRevealStatus: boolean;
  index:            number;
}) {
  const commitStatus: ActionStatus = !player.isActive
    ? "inactive"
    : player.hasCommitted ? "done" : "pending";

  const revealStatus: ActionStatus = !player.isActive
    ? "inactive"
    : player.hasRevealed ? "done" : "pending";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: player.isActive ? 1 : 0.45, x: 0 }}
      transition={{ duration: 0.15, delay: index * 0.02 }}
      className={cn(
        "flex items-center gap-2.5 px-3 py-2 rounded-[6px] transition-colors duration-150",
        isYou ? "bg-[#008751]/5" : "hover:bg-[#2D2D2D]/50",
      )}
    >
      {/* Status dot */}
      <StatusDot isActive={player.isActive} />

      {/* Avatar initials */}
      <div className={cn(
        "w-6 h-6 rounded-full flex items-center justify-center shrink-0",
        "text-[9px] font-mono font-bold select-none",
        isYou
          ? "bg-[#008751]/20 text-[#008751]"
          : player.isActive
          ? "bg-[#2D2D2D] text-[#9B9B9B]"
          : "bg-[#1A1A1A] text-[#9B9B9B]",
      )}>
        {player.addr.slice(2, 4).toUpperCase()}
      </div>

      {/* Address */}
      <span className={cn(
        "font-mono text-xs flex-1 truncate",
        isYou       ? "text-white"
        : player.isActive ? "text-[#9B9B9B]"
        : "text-[#9B9B9B] line-through opacity-60",
      )}>
        {formatAddress(player.addr, 4)}
      </span>

      {/* You badge */}
      {isYou && (
        <span className="text-[9px] text-[#008751] border border-[#008751]/30 rounded px-1 shrink-0">
          You
        </span>
      )}

      {/* Commit status */}
      {showCommitStatus && (
        <ActionIcon status={commitStatus} type="commit" />
      )}

      {/* Reveal status */}
      {showRevealStatus && (
        <ActionIcon status={revealStatus} type="reveal" />
      )}

      {/* Round score — show once non-zero */}
      {player.roundScore > 0n && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-xs font-semibold tabular-nums text-[#0F7B6C] shrink-0"
        >
          {player.roundScore.toString()}
        </motion.span>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//                           MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
type PlayerListProps = {
  players:          PlayerData[];
  myAddress:        `0x${string}` | undefined;
  gameId:           bigint;
  round:            number;
  showCommitStatus: boolean;
  showRevealStatus: boolean;
  className?:       string;
};

export default function PlayerList({
  players,
  myAddress,
  gameId,
  round,
  showCommitStatus,
  showRevealStatus,
  className,
}: PlayerListProps) {
  // Sort: active first, then by roundScore desc, eliminated last
  const sorted = useMemo(() => {
    return [...players].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      if (b.roundScore !== a.roundScore) {
        return b.roundScore > a.roundScore ? 1 : -1;
      }
      return 0;
    });
  }, [players]);

  const activeCount    = players.filter((p) => p.isActive).length;
  const committedCount = players.filter((p) => p.isActive && p.hasCommitted).length;
  const revealedCount  = players.filter((p) => p.isActive && p.hasRevealed).length;

  if (sorted.length === 0) {
    return (
      <div className={cn("card px-4 py-5 text-center text-sm text-[#9B9B9B]", className)}>
        <UserCircle02Icon size={24} className="mx-auto mb-2 opacity-30" />
        No players yet
      </div>
    );
  }

  return (
    <div className={cn("card overflow-hidden", className)}>
      {/* Header with live counters */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#2D2D2D]">
        <span className="label">
          {activeCount} active player{activeCount !== 1 ? "s" : ""}
        </span>

        {/* Phase-specific counter */}
        <AnimatePresence mode="wait">
          {showCommitStatus && (
            <motion.div
              key="commit-counter"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5 text-xs text-[#9B9B9B]"
            >
              <SquareLockPasswordIcon size={12} className="text-[#008751]" />
              <span>
                <span className="text-white font-medium">{committedCount}</span>
                /{activeCount} committed
              </span>
            </motion.div>
          )}

          {showRevealStatus && (
            <motion.div
              key="reveal-counter"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5 text-xs text-[#9B9B9B]"
            >
              <EyeIcon size={12} className="text-[#DFAB01]" />
              <span>
                <span className="text-white font-medium">{revealedCount}</span>
                /{activeCount} revealed
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Player rows */}
      <div className="p-1.5 space-y-0.5">
        <AnimatePresence mode="popLayout">
          {sorted.map((player, i) => (
            <PlayerRow
              key={player.addr}
              player={player}
              isYou={
                !!myAddress &&
                player.addr.toLowerCase() === myAddress.toLowerCase()
              }
              showCommitStatus={showCommitStatus}
              showRevealStatus={showRevealStatus}
              index={i}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Legend */}
      {(showCommitStatus || showRevealStatus) && (
        <div className="border-t border-[#2D2D2D] px-4 py-2 flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-[10px] text-[#9B9B9B]">
            {showCommitStatus
              ? <><SquareLockPasswordIcon size={11} className="text-[#008751]" /> Committed</>
              : <><EyeIcon size={11} className="text-[#008751]" /> Revealed</>
            }
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-[#9B9B9B]">
            <Clock01Icon size={11} className="text-[#2D2D2D]" />
            Waiting
          </span>
        </div>
      )}
    </div>
  );
}
