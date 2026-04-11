/**
 * utils.ts — ICallOn frontend utility functions
 *
 * generateSalt()    — cryptographically random 32-byte salt for commit-reveal
 * hashAnswers()     — keccak256(answers + salt) matching the Solidity hash
 * formatAddress()   — "0x1234…abcd" truncation for display
 * formatMON()       — wei → "1.23 MON" for prize pool display
 * letterFromBytes1() — bytes1 hex → "M" character
 * cn()              — Tailwind class merge utility (clsx + tailwind-merge)
 * getTimeRemaining() — seconds left from a Unix deadline
 * formatCountdown()  — "0:35" from seconds remaining
 * getErrorMessage()  — parse wagmi/viem ContractFunctionRevertedError → string
 * getCategoryIcon()  — category index → Hugeicons component name
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { encodePacked, keccak256 } from "viem";
import { CONTRACT_ERRORS, type Category } from "./contract";

// ── cn() — Tailwind class merge ───────────────────────────────────────────────
// Standard shadcn/ui pattern. Merges Tailwind classes intelligently so that
// later classes win (e.g. cn("text-red-500", "text-green-500") → "text-green-500")

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ── generateSalt() — cryptographic random salt ────────────────────────────────
/**
 * Generate a random 32-byte salt for the commit-reveal scheme.
 *
 * Uses crypto.getRandomValues() (Web Crypto API) — available in all modern
 * browsers and in Node.js 15+. Never use Math.random() for this — it is not
 * cryptographically secure and a determined opponent could brute-force it.
 *
 * The salt is stored in sessionStorage so the player can reveal even if they
 * accidentally refresh the page during the reveal phase.
 *
 * @returns A 0x-prefixed 32-byte hex string (bytes32 in Solidity)
 */
export function generateSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}

// ── hashAnswers() — commit hash matching Solidity ────────────────────────────
/**
 * Compute the commit hash that matches the on-chain verification in revealAnswers().
 *
 * Solidity: keccak256(abi.encodePacked(a0, a1, a2, a3, a4, salt))
 *
 * IMPORTANT — abi.encodePacked vs abi.encode:
 *   encodePacked concatenates values with NO padding/length prefixes.
 *   For strings this means ["Mo", "nkey"] encodes the same as ["Mon", "key"].
 *   This is fine here because the salt makes collisions irrelevant, and it
 *   exactly matches what Solidity's abi.encodePacked produces.
 *
 * viem's encodePacked() mirrors Solidity's abi.encodePacked exactly.
 *
 * @param answers  Exactly 5 strings: [person, place, thing, animal, food]
 * @param salt     32-byte hex salt from generateSalt()
 * @returns        bytes32 keccak256 hash as 0x-prefixed hex
 */
export function hashAnswers(
  answers: [string, string, string, string, string],
  salt: `0x${string}`
): `0x${string}` {
  // Mirror Solidity: keccak256(abi.encodePacked(a0, a1, a2, a3, a4, salt))
  // viem's encodePacked exactly mirrors Solidity's abi.encodePacked
  return keccak256(encodePacked(
    ["string", "string", "string", "string", "string", "bytes32"],
    [answers[0], answers[1], answers[2], answers[3], answers[4], salt]
  ));
}

// ── Salt persistence (sessionStorage) ────────────────────────────────────────
/**
 * Save the salt for a game+round to sessionStorage.
 * Players who refresh mid-game can still reveal their answers.
 */
export function saveSalt(
  gameId: bigint,
  round: number,
  salt: `0x${string}`
): void {
  if (typeof window === "undefined") return;
  const key = `icallon_salt_${gameId}_${round}`;
  sessionStorage.setItem(key, salt);
}

/**
 * Retrieve the saved salt for a game+round.
 * Returns null if not found (player cleared storage or used different device).
 */
export function loadSalt(
  gameId: bigint,
  round: number
): `0x${string}` | null {
  if (typeof window === "undefined") return null;
  const key = `icallon_salt_${gameId}_${round}`;
  const val = sessionStorage.getItem(key);
  return val ? (val as `0x${string}`) : null;
}

/**
 * Save the raw answers for a game+round to sessionStorage.
 * Required for reveal — the answers must exactly match what was committed.
 */
export function saveAnswers(
  gameId: bigint,
  round: number,
  answers: [string, string, string, string, string]
): void {
  if (typeof window === "undefined") return;
  const key = `icallon_answers_${gameId}_${round}`;
  sessionStorage.setItem(key, JSON.stringify(answers));
}

/**
 * Retrieve saved answers for a game+round.
 */
export function loadAnswers(
  gameId: bigint,
  round: number
): [string, string, string, string, string] | null {
  if (typeof window === "undefined") return null;
  const key = `icallon_answers_${gameId}_${round}`;
  const val = sessionStorage.getItem(key);
  if (!val) return null;
  try {
    return JSON.parse(val) as [string, string, string, string, string];
  } catch {
    return null;
  }
}

// ── formatAddress() — wallet address truncation ───────────────────────────────
/**
 * Format a full wallet address for display.
 * "0x1234567890abcdef..." → "0x1234…cdef"
 *
 * @param address  Full 0x-prefixed address
 * @param chars    Number of chars to show on each side (default 4)
 */
export function formatAddress(
  address: `0x${string}` | string | undefined,
  chars = 4
): string {
  if (!address) return "—";
  if (address.length < chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}

// ── formatMON() — wei to human-readable MON ──────────────────────────────────
/**
 * Format a bigint wei amount to a human-readable MON string.
 * 1_000_000_000_000_000_000n → "1.00 MON"
 * 500_000_000_000_000_000n  → "0.50 MON"
 */
export function formatMON(wei: bigint, decimals = 2): string {
  const mon = Number(wei) / 1e18;
  return `${mon.toFixed(decimals)} MON`;
}

// ── letterFromBytes1() — bytes1 hex → display character ──────────────────────
/**
 * Convert a bytes1 value (returned by getCurrentLetter()) to a display character.
 * viem returns bytes1 as a 0x-prefixed 2-char hex string, e.g. "0x4d" = 'M'
 *
 * @param bytes1  e.g. "0x4d" or "0x4D"
 * @returns       "M"
 */
export function letterFromBytes1(bytes1: string | undefined): string {
  if (!bytes1) return "?";
  // bytes1 comes as "0x4d" from viem
  const charCode = parseInt(bytes1.slice(2), 16);
  if (isNaN(charCode) || charCode < 65 || charCode > 90) return "?";
  return String.fromCharCode(charCode);
}

// ── getTimeRemaining() — seconds until a Unix deadline ───────────────────────
/**
 * Get seconds remaining until a Unix timestamp deadline.
 * Returns 0 if the deadline has already passed.
 *
 * @param deadline  Unix timestamp in seconds (bigint from contract)
 */
export function getTimeRemaining(deadline: bigint | number): number {
  const now = Math.floor(Date.now() / 1000);
  const diff = Number(deadline) - now;
  return Math.max(0, diff);
}

// ── formatCountdown() — seconds → "0:35" display string ─────────────────────
/**
 * Format a seconds count as "m:ss" for the countdown timer.
 * 35 → "0:35"   90 → "1:30"   5 → "0:05"
 */
export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── getErrorMessage() — parse contract revert errors ─────────────────────────
/**
 * Extract a human-readable error message from a wagmi/viem write error.
 *
 * wagmi v2 wraps contract revert errors as ContractFunctionRevertedError
 * with a `data.errorName` field matching the custom error name in Solidity.
 *
 * Falls back to the raw error message if the error isn't a known contract error.
 */
export function getErrorMessage(error: unknown): string {
  if (!error) return "Unknown error";

  // wagmi/viem ContractFunctionRevertedError shape
  if (typeof error === "object" && error !== null) {
    const err = error as Record<string, unknown>;

    // Check for viem's ContractFunctionRevertedError
    if (err.name === "ContractFunctionRevertedError") {
      const data = err.data as Record<string, unknown> | undefined;
      const errorName = data?.errorName as string | undefined;
      if (errorName && CONTRACT_ERRORS[errorName]) {
        return CONTRACT_ERRORS[errorName];
      }
    }

    // Check nested cause (wagmi wraps errors)
    if (err.cause && typeof err.cause === "object") {
      const cause = err.cause as Record<string, unknown>;
      if (cause.name === "ContractFunctionRevertedError") {
        const data = cause.data as Record<string, unknown> | undefined;
        const errorName = data?.errorName as string | undefined;
        if (errorName && CONTRACT_ERRORS[errorName]) {
          return CONTRACT_ERRORS[errorName];
        }
      }
      // shortMessage is set by viem for user-facing display
      if (typeof cause.shortMessage === "string") {
        return cause.shortMessage;
      }
    }

    // shortMessage directly on error
    if (typeof err.shortMessage === "string") return err.shortMessage;
    if (typeof err.message === "string") return err.message;
  }

  if (typeof error === "string") return error;
  return "Transaction failed";
}

// ── validateAnswer() — client-side first-letter check ───────────────────────
/**
 * Check that an answer starts with the required letter before submitting.
 * Mirrors the on-chain check in revealAnswers() so players get instant feedback.
 *
 * @param answer  The player's answer string
 * @param letter  The round letter ('M', 'A', etc.)
 * @returns       true if valid (or empty — empty is allowed)
 */
export function validateAnswer(answer: string, letter: string): boolean {
  if (answer.trim() === "") return true; // Empty = allowed, scores 0
  return answer.trim()[0].toUpperCase() === letter.toUpperCase();
}

// ── getCategoryIcon() — Hugeicons icon name per category ─────────────────────
/**
 * Returns the Hugeicons component name for each category.
 * Import these dynamically in components:
 *   import { UserIcon, LocationIcon, ... } from "@hugeicons/react"
 */
export const CATEGORY_ICONS = {
  0: "UserCircle02Icon",   // Person
  1: "Location01Icon",     // Place
  2: "Package01Icon",      // Thing
  3: "Cat01Icon",          // Animal
  4: "ForkSpoonIcon",      // Food
} as const satisfies Record<Category, string>;

// ── scoreColor() — Tailwind color class for a score row ──────────────────────
/**
 * Returns Tailwind text color class based on score status:
 *   - unique  → green  (#0F7B6C)
 *   - shared  → yellow (#DFAB01)
 *   - flagged → red    (#E03E3E)
 *   - empty   → muted  (#9B9B9B)
 */
export type ScoreStatus = "unique" | "shared" | "flagged" | "empty";

export function scoreColor(status: ScoreStatus): string {
  switch (status) {
    case "unique":  return "text-[#0F7B6C]";
    case "shared":  return "text-[#DFAB01]";
    case "flagged": return "text-[#E03E3E]";
    case "empty":   return "text-[#9B9B9B]";
  }
}

// ── shortenRound() — "Round 1 of 4" label ─────────────────────────────────────
export function roundLabel(round: number): string {
  const labels: Record<number, string> = {
    1: "Round 1 — 16 players",
    2: "Round 2 — 8 players",
    3: "Semi-Final — 4 players",
    4: "Final — 2 players",
  };
  return labels[round] ?? `Round ${round}`;
}

// ── isDeadlinePassed() — check if a contract deadline has passed ──────────────
export function isDeadlinePassed(deadline: bigint | number): boolean {
  return getTimeRemaining(deadline) === 0;
}

// ── getPhaseDeadline() — pick the active deadline for a given state ───────────
import { GameState } from "./contract";

export function getPhaseDeadline(
  state: GameState,
  commitDeadline: bigint,
  revealDeadline: bigint,
  flagDeadline: bigint
): bigint | null {
  switch (state) {
    case GameState.COMMIT:   return commitDeadline;
    case GameState.REVEAL:   return revealDeadline;
    case GameState.FLAGGING: return flagDeadline;
    default:                 return null;
  }
}
