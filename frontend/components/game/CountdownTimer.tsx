"use client";

/**
 * CountdownTimer.tsx — Live countdown to a contract deadline
 *
 * Reads a Unix timestamp deadline (bigint from the contract) and counts
 * down in real time using a 1-second setInterval on the client.
 *
 * Behaviour:
 *  - Green  (>10s)  : normal, calm
 *  - Yellow (6–10s) : warning — players should be wrapping up
 *  - Red    (1–5s)  : urgent — shake animation, red text
 *  - Expired (0s)   : shows "Time's up" with a distinct icon
 *
 * compact prop: renders just the "0:35" string inline (for nav bar use)
 * Full mode:    renders the full timer card with icon + label
 *
 * Monad note: the contract deadline is set as block.timestamp + DURATION.
 * Monad's ~0.4s block time means the deadline is accurate to within 1 block.
 * We sync the countdown to Date.now() (client wall clock) which can drift
 * slightly from chain time — acceptable for a visual countdown.
 */

import { Timer01Icon, AlarmClockIcon, Clock01Icon } from "@hugeicons/react";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { cn, formatCountdown, getTimeRemaining } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
type TimerStage = "normal" | "warning" | "urgent" | "expired";

function getStage(seconds: number): TimerStage {
  if (seconds <= 0)  return "expired";
  if (seconds <= 5)  return "urgent";
  if (seconds <= 10) return "warning";
  return "normal";
}

type CountdownTimerProps = {
  /** Unix timestamp in seconds (bigint or number from contract) */
  deadline:   bigint | number;
  /** Compact inline mode — just "0:35" text, no icon/card */
  compact?:   boolean;
  /** Called once when the timer hits zero */
  onExpire?:  () => void;
  /** Optional label shown below the time in full mode */
  label?:     string;
  className?: string;
};

// ── Compact variant (inline in nav / header) ──────────────────────────────────
function CompactTimer({
  seconds,
  stage,
}: {
  seconds: number;
  stage:   TimerStage;
}) {
  const colorClass = {
    normal:  "text-[#9B9B9B]",
    warning: "text-[#DFAB01]",
    urgent:  "text-[#E03E3E]",
    expired: "text-[#9B9B9B]",
  }[stage];

  if (stage === "expired") {
    return <span className="text-xs text-[#9B9B9B]">Ended</span>;
  }

  return (
    <motion.span
      key={Math.ceil(seconds / 1)} // re-key every second to trigger digit flip
      className={cn("text-sm font-mono font-semibold tabular-nums", colorClass)}
      animate={stage === "urgent" ? { scale: [1, 1.08, 1] } : {}}
      transition={{ duration: 0.3 }}
    >
      {formatCountdown(seconds)}
    </motion.span>
  );
}

// ── Full variant (standalone card row) ────────────────────────────────────────
function FullTimer({
  seconds,
  stage,
  label,
}: {
  seconds: number;
  stage:   TimerStage;
  label?:  string;
}) {
  const colorMap = {
    normal:  { text: "text-white",        icon: "text-[#9B9B9B]",   bg: ""                              },
    warning: { text: "text-[#DFAB01]",    icon: "text-[#DFAB01]",   bg: "bg-[#DFAB01]/5"               },
    urgent:  { text: "text-[#E03E3E]",    icon: "text-[#E03E3E]",   bg: "bg-[#E03E3E]/5"               },
    expired: { text: "text-[#9B9B9B]",    icon: "text-[#9B9B9B]",   bg: ""                              },
  }[stage];

  const Icon = stage === "expired" ? AlarmClockIcon
             : stage === "urgent"  ? AlarmClockIcon
             : Timer01Icon;

  return (
    <div className={cn("flex items-center gap-3", colorMap.bg)}>
      {/* Icon — shakes in urgent mode */}
      <motion.div
        animate={
          stage === "urgent"
            ? { rotate: [-8, 8, -8, 8, 0], transition: { duration: 0.5, repeat: Infinity, repeatDelay: 0.3 } }
            : { rotate: 0 }
        }
      >
        <Icon size={18} className={colorMap.icon} />
      </motion.div>

      {/* Time display */}
      <div className="flex flex-col">
        <AnimatePresence mode="wait">
          {stage === "expired" ? (
            <motion.span
              key="expired"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm font-medium text-[#9B9B9B]"
            >
              Time&apos;s up
            </motion.span>
          ) : (
            <motion.span
              key={seconds}
              initial={{ opacity: 0.7, y: -2 }}
              animate={{ opacity: 1,   y: 0  }}
              transition={{ duration: 0.15 }}
              className={cn(
                "text-2xl font-bold font-mono tabular-nums leading-none",
                colorMap.text
              )}
            >
              {formatCountdown(seconds)}
            </motion.span>
          )}
        </AnimatePresence>

        {label && (
          <span className="text-xs text-[#9B9B9B] mt-0.5">{label}</span>
        )}
      </div>

      {/* Urgency pips — 5 dots that empty out in the last 5 seconds */}
      {stage === "urgent" && seconds > 0 && (
        <div className="flex gap-1 ml-auto">
          {Array.from({ length: 5 }, (_, i) => (
            <motion.div
              key={i}
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                i < seconds ? "bg-[#E03E3E]" : "bg-[#2D2D2D]"
              )}
              animate={i < seconds ? { scale: [1, 1.3, 1] } : {}}
              transition={{ duration: 0.4, delay: i * 0.05 }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//                           MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function CountdownTimer({
  deadline,
  compact   = false,
  onExpire,
  label,
  className,
}: CountdownTimerProps) {
  const [seconds, setSeconds]   = useState(() => getTimeRemaining(deadline));
  const onExpireRef             = useRef(onExpire);
  const expiredFiredRef         = useRef(false);

  // Keep callback ref fresh without re-subscribing the interval
  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);

  // Tick every second
  useEffect(() => {
    expiredFiredRef.current = false;
    setSeconds(getTimeRemaining(deadline));

    const id = setInterval(() => {
      const remaining = getTimeRemaining(deadline);
      setSeconds(remaining);

      if (remaining === 0 && !expiredFiredRef.current) {
        expiredFiredRef.current = true;
        onExpireRef.current?.();
      }
    }, 1_000);

    return () => clearInterval(id);
  }, [deadline]);

  const stage = getStage(seconds);

  if (compact) {
    return (
      <span className={className}>
        <CompactTimer seconds={seconds} stage={stage} />
      </span>
    );
  }

  return (
    <div className={className}>
      <FullTimer seconds={seconds} stage={stage} label={label} />
    </div>
  );
}
