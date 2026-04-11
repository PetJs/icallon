"use client";

/**
 * FlagButton.tsx — Per-answer flag button for the flagging phase
 *
 * Renders a compact flag button for a single answer cell.
 * Behaviour:
 *   - Idle:     grey flag icon + count (if any)
 *   - Hovering: red tint, flag icon fills
 *   - Flagged:  solid red, locked — you cannot un-flag
 *   - Pending:  spinner while tx confirms (Monad: ~0.4s)
 *   - Disabled: outside flagging phase, or already flagged
 *
 * Shows the current flag count and a threshold indicator:
 *   e.g. "2/8" means 2 flags out of 8 active players.
 *   When count reaches ≥50% the button turns orange as a warning
 *   that this answer is about to be nuked.
 *
 * Uses useReadContract to read flagCount + hasFlagged on mount,
 * then optimistically updates count on successful tx.
 */

import { Flag01Icon } from "@hugeicons/react";
import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";

import { useFlagAnswer, useFlagCount, useHasFlagged } from "@/hooks/useICallOn";
import { Category } from "@/lib/contract";
import { cn } from "@/lib/utils";

// ── Threshold colour ──────────────────────────────────────────────────────────
// Green → none flagged
// Yellow → approaching threshold (>25% flagged)
// Orange → near threshold (>35%)
// Red → at/over threshold (≥50% = answer nuked)
function thresholdColor(count: number, total: number): string {
  if (total === 0 || count === 0) return "text-[#9B9B9B]";
  const ratio = count / total;
  if (ratio >= 0.5)  return "text-[#E03E3E]";
  if (ratio >= 0.35) return "text-[#FF8C00]";
  if (ratio >= 0.25) return "text-[#DFAB01]";
  return "text-[#9B9B9B]";
}

function thresholdBg(count: number, total: number): string {
  if (total === 0 || count === 0) return "";
  const ratio = count / total;
  if (ratio >= 0.5)  return "bg-[#E03E3E]/10 border-[#E03E3E]/30";
  if (ratio >= 0.35) return "bg-[#FF8C00]/10 border-[#FF8C00]/30";
  if (ratio >= 0.25) return "bg-[#DFAB01]/10 border-[#DFAB01]/30";
  return "";
}

// ─────────────────────────────────────────────────────────────────────────────
//                           MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
type FlagButtonProps = {
  gameId:        bigint;
  round:         number;
  flaggedPlayer: `0x${string}`;
  category:      Category;
  /** Total active player count — used to show "2/8" threshold indicator */
  activeCount:   number;
};

export default function FlagButton({
  gameId,
  round,
  flaggedPlayer,
  category,
  activeCount,
}: FlagButtonProps) {
  const { address } = useAccount();

  // ── Read current state ────────────────────────────────────────────────────
  const { flagCount,  refetch: refetchCount  } = useFlagCount(gameId, round, flaggedPlayer, category);
  const { hasFlagged, refetch: refetchFlagged } = useHasFlagged(gameId, round, flaggedPlayer, category);

  // ── Optimistic local state ────────────────────────────────────────────────
  // Update count instantly on success — don't wait for next poll
  const [localCount,  setLocalCount]  = useState(flagCount);
  const [localFlagged, setLocalFlagged] = useState(hasFlagged);

  // Sync from chain reads
  useEffect(() => { setLocalCount(flagCount);   }, [flagCount]);
  useEffect(() => { setLocalFlagged(hasFlagged); }, [hasFlagged]);

  // ── Write ─────────────────────────────────────────────────────────────────
  const flagHook = useFlagAnswer(gameId, round);

  // After tx confirms, optimistically update and refetch
  useEffect(() => {
    if (flagHook.isSuccess) {
      setLocalCount((n) => n + 1);
      setLocalFlagged(true);
      // Refetch to sync with chain (happens within ~0.4s on Monad)
      refetchCount();
      refetchFlagged();
      flagHook.reset();
    }
  }, [flagHook.isSuccess, flagHook, refetchCount, refetchFlagged]);

  const handleFlag = useCallback(() => {
    if (localFlagged || flagHook.isPending || flagHook.isConfirming) return;
    flagHook.execute(flaggedPlayer, category);
  }, [localFlagged, flagHook, flaggedPlayer, category]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const isDisabled  = localFlagged || flagHook.isPending || flagHook.isConfirming || !address;
  const isPending   = flagHook.isPending || flagHook.isConfirming;
  const isNuked     = activeCount > 0 && localCount * 2 >= activeCount; // ≥50%

  const countColor  = thresholdColor(localCount, activeCount);
  const countBg     = thresholdBg(localCount, activeCount);

  return (
    <div className="flex items-center gap-1 shrink-0">
      {/* Flag count badge — only show if > 0 */}
      <AnimatePresence>
        {localCount > 0 && (
          <motion.span
            key={localCount}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className={cn(
              "text-[10px] font-mono font-semibold tabular-nums",
              "px-1.5 py-0.5 rounded border",
              countColor,
              countBg || "border-transparent",
            )}
            title={`${localCount} of ${activeCount} players flagged this answer${isNuked ? " — NUKED (0 pts)" : ""}`}
          >
            {localCount}/{activeCount}
          </motion.span>
        )}
      </AnimatePresence>

      {/* Flag button */}
      <motion.button
        onClick={handleFlag}
        disabled={isDisabled}
        whileTap={!isDisabled ? { scale: 0.88 } : {}}
        title={
          localFlagged ? "You flagged this"
          : isNuked    ? "Answer nuked (≥50% flagged)"
          : `Flag this answer`
        }
        className={cn(
          "relative w-7 h-7 rounded-[6px] flex items-center justify-center",
          "border transition-all duration-150 select-none",
          // Flagged (locked)
          localFlagged
            ? "bg-[#E03E3E]/15 border-[#E03E3E]/40 cursor-default"
            : isNuked
            // Nuked by others — show warning state even if you didn't flag
            ? "bg-[#E03E3E]/10 border-[#E03E3E]/30 cursor-default"
            : isPending
            // Pending tx
            ? "bg-[#2D2D2D] border-[#2D2D2D] cursor-wait"
            : isDisabled
            ? "opacity-30 cursor-not-allowed border-transparent"
            // Interactive idle
            : "bg-transparent border-[#2D2D2D] hover:bg-[#E03E3E]/10 hover:border-[#E03E3E]/40 cursor-pointer"
        )}
        aria-label={localFlagged ? "Flagged" : "Flag answer"}
        aria-pressed={localFlagged}
      >
        {isPending ? (
          /* Spinner — Monad confirms in ~0.4s so this barely shows */
          <span className="w-3 h-3 border-2 border-[#E03E3E]/30 border-t-[#E03E3E] rounded-full animate-spin" />
        ) : (
          <Flag01Icon
            size={14}
            className={cn(
              "transition-colors duration-150",
              localFlagged
                ? "text-[#E03E3E]"
                : isNuked
                ? "text-[#E03E3E]/60"
                : "text-[#9B9B9B] group-hover:text-[#E03E3E]"
            )}
          />
        )}

        {/* Flagged pulse ring — fires once when you flag */}
        <AnimatePresence>
          {localFlagged && (
            <motion.span
              key="pulse"
              className="absolute inset-0 rounded-[6px] border border-[#E03E3E]"
              initial={{ opacity: 0.8, scale: 1 }}
              animate={{ opacity: 0,   scale: 1.6 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}
