"use client";

/**
 * LetterReveal.tsx — Full-screen dramatic letter reveal animation
 *
 * This is the ONE component in ICallOn that intentionally breaks the
 * Notion minimalism design system. Everything else is #0F0F0F and subtle
 * borders. This is the MOMENT. Make it feel like a stadium countdown.
 *
 * Animation sequence (total ~3.2s):
 *   0.0s  — Black overlay fades in, covering the game screen
 *   0.3s  — "Round N" label slides up
 *   0.6s  — "I CALL ON..." text pulses in
 *   1.0s  — Large letter slams in with a spring (scale 3→1, with bounce)
 *   1.4s  — Letter glows green, particle rings expand outward
 *   2.0s  — "35 seconds" subtitle fades in
 *   2.5s  — onComplete() fires — overlay fades out, game UI resumes
 *
 * The letter is shown for ~1.5s at full size before dismissing — long enough
 * to register on mobile without stalling the 35-second clock (which the
 * contract already started in the same block as startRound()).
 *
 * Monad note: startRound() confirms in ~0.4s. By the time the animation
 * finishes (~3s total), players have lost <10% of their commit window.
 * The animation is a feature, not a delay — players are reading the letter
 * while the UI plays it out.
 */

import { motion, AnimatePresence, useAnimation } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { roundLabel } from "@/lib/utils";

// ── Floating particle ring ────────────────────────────────────────────────────
function ParticleRing({ delay }: { delay: number }) {
  return (
    <motion.div
      className="absolute inset-0 rounded-full border-2 border-[#008751]"
      initial={{ scale: 0.8, opacity: 0.8 }}
      animate={{ scale: 2.8, opacity: 0 }}
      transition={{
        duration: 1.4,
        delay,
        ease: "easeOut",
      }}
    />
  );
}

// ── Floating letter ghost (blurred echo) ──────────────────────────────────────
function LetterGhost({
  letter,
  delay,
  x,
  y,
}: {
  letter: string;
  delay: number;
  x: string;
  y: string;
}) {
  return (
    <motion.span
      className="absolute text-[12rem] font-black text-[#008751] select-none pointer-events-none"
      style={{ left: x, top: y, filter: "blur(40px)" }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: [0, 0.12, 0], scale: [0.6, 1.4, 1.8] }}
      transition={{ duration: 2.5, delay, ease: "easeOut" }}
    >
      {letter}
    </motion.span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//                           MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
type LetterRevealProps = {
  letter:     string;  // "M", "A", "Z", etc.
  round:      number;  // 1–4
  onComplete: () => void;
};

export default function LetterReveal({
  letter,
  round,
  onComplete,
}: LetterRevealProps) {
  const [showParticles, setShowParticles] = useState(false);
  const [phase, setPhase]                 = useState<"in" | "hold" | "out">("in");
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current) return;

    // Sequence timers
    const t1 = setTimeout(() => setShowParticles(true),  1000); // particles at letter slam
    const t2 = setTimeout(() => setPhase("out"),          3000); // start exit
    const t3 = setTimeout(() => {
      if (!doneRef.current) {
        doneRef.current = true;
        onComplete();
      }
    }, 3600); // call parent after fade-out completes

    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onComplete]);

  // Glow colours cycle through Nigerian flag: green → white → green
  const glowColor = "#008751";

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
      style={{ background: "#0A0A0A" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: phase === "out" ? 0 : 1 }}
      transition={{ duration: phase === "out" ? 0.5 : 0.25, ease: "easeInOut" }}
    >
      {/* ── Background grid (subtle, Nigerian feel) ─────────────────────── */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0,135,81,0.8) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,135,81,0.8) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />

      {/* ── Ghost letters (ambient background) ──────────────────────────── */}
      <LetterGhost letter={letter} delay={0.8} x="-5%"  y="5%"  />
      <LetterGhost letter={letter} delay={1.0} x="65%"  y="55%" />
      <LetterGhost letter={letter} delay={1.2} x="20%"  y="65%" />

      {/* ── Round label ──────────────────────────────────────────────────── */}
      <motion.p
        className="absolute top-16 left-0 right-0 text-center text-sm font-medium uppercase tracking-[0.25em] text-[#9B9B9B]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.4, ease: "easeOut" }}
      >
        {roundLabel(round)}
      </motion.p>

      {/* ── "I CALL ON..." label ──────────────────────────────────────────── */}
      <motion.p
        className="absolute text-center font-black uppercase tracking-[0.15em] text-white/20 select-none"
        style={{ fontSize: "clamp(1rem, 4vw, 1.5rem)", top: "calc(50% - 120px)" }}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.55, duration: 0.4, ease: "easeOut" }}
      >
        I Call On...
      </motion.p>

      {/* ── Central letter container ──────────────────────────────────────── */}
      <div className="relative flex items-center justify-center">

        {/* Particle rings — emitted when letter slams in */}
        {showParticles && (
          <div className="absolute w-32 h-32">
            <ParticleRing delay={0}    />
            <ParticleRing delay={0.18} />
            <ParticleRing delay={0.36} />
          </div>
        )}

        {/* Glow blob behind letter */}
        <motion.div
          className="absolute rounded-full"
          style={{
            width: "280px",
            height: "280px",
            background: `radial-gradient(circle, ${glowColor}55 0%, ${glowColor}11 50%, transparent 75%)`,
          }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{
            scale:   [0, 1.3, 1.0],
            opacity: [0, 0.8, 0.5],
          }}
          transition={{ delay: 0.95, duration: 0.6, ease: "easeOut" }}
        />

        {/* THE LETTER */}
        <motion.span
          className="relative select-none font-black leading-none"
          style={{
            fontSize:   "clamp(8rem, 28vw, 18rem)",
            color:      "#FFFFFF",
            fontFamily: "var(--font-inter), Inter, system-ui",
            // Text shadow stack: white core → green mid → deep green outer
            textShadow: `
              0 0 0px   #FFFFFF,
              0 0 30px  #FFFFFF88,
              0 0 60px  ${glowColor}99,
              0 0 120px ${glowColor}55
            `,
          }}
          initial={{ scale: 4, opacity: 0, y: 20 }}
          animate={{
            scale:   [4, 0.85, 1.05, 1.0],
            opacity: [0, 1,    1,    1   ],
            y:       [20, 0,   0,    0   ],
          }}
          transition={{
            delay:    0.95,
            duration: 0.55,
            ease:     [0.22, 1, 0.36, 1], // custom spring curve
            times:    [0, 0.55, 0.8, 1],
          }}
        >
          {letter}
        </motion.span>

        {/* Scan line — sweeps across the letter once */}
        <motion.div
          className="absolute inset-0 pointer-events-none overflow-hidden"
          style={{ borderRadius: "4px" }}
        >
          <motion.div
            className="absolute left-0 right-0 h-px"
            style={{ background: `linear-gradient(90deg, transparent, ${glowColor}, transparent)` }}
            initial={{ top: "0%", opacity: 0 }}
            animate={{ top: ["0%", "100%"], opacity: [0, 0.7, 0] }}
            transition={{ delay: 1.1, duration: 0.5, ease: "easeInOut" }}
          />
        </motion.div>
      </div>

      {/* ── "35 seconds — GO!" subtitle ──────────────────────────────────── */}
      <motion.div
        className="absolute text-center space-y-1"
        style={{ bottom: "calc(50% - 180px)" }}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2.0, duration: 0.4, ease: "easeOut" }}
      >
        <p className="text-sm font-semibold text-[#9B9B9B] uppercase tracking-widest">
          35 seconds
        </p>
        <motion.p
          className="text-xs text-[#008751] uppercase tracking-[0.3em] font-bold"
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 0.8, repeat: 1, delay: 2.1 }}
        >
          Fill in all 5 categories — GO!
        </motion.p>
      </motion.div>

      {/* ── Corner brackets (game-feel detail) ──────────────────────────── */}
      {["top-6 left-6", "top-6 right-6", "bottom-6 left-6", "bottom-6 right-6"].map(
        (pos, i) => (
          <motion.div
            key={i}
            className={`absolute ${pos} w-6 h-6`}
            style={{
              borderColor: "#008751",
              borderStyle: "solid",
              borderTopWidth:    i < 2 ? "2px" : "0",
              borderBottomWidth: i >= 2 ? "2px" : "0",
              borderLeftWidth:   i % 2 === 0 ? "2px" : "0",
              borderRightWidth:  i % 2 === 1 ? "2px" : "0",
            }}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 0.5, scale: 1 }}
            transition={{ delay: 0.2 + i * 0.05, duration: 0.3 }}
          />
        )
      )}

      {/* ── Tap to skip (mobile UX) ──────────────────────────────────────── */}
      <motion.button
        className="absolute bottom-8 left-0 right-0 text-center text-xs text-[#9B9B9B]/40 select-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.8 }}
        onClick={() => {
          if (!doneRef.current) {
            doneRef.current = true;
            onComplete();
          }
        }}
      >
        tap to skip
      </motion.button>
    </motion.div>
  );
}
