/**
 * contract.ts — ICallOn ABI + TypeScript types
 *
 * The ABI is declared `as const` so wagmi v2's useReadContract /
 * useWriteContract can infer argument and return types automatically.
 * Never use `any` — let TypeScript narrow everything from the ABI.
 *
 * UPDATE CONTRACT_ADDRESS after running Deploy.s.sol:
 *   forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
 *   → copy the address logged to console into NEXT_PUBLIC_CONTRACT_ADDRESS
 */

// ── Contract address ──────────────────────────────────────────────────────────
export const CONTRACT_ADDRESS =
  (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS?.trim() as `0x${string}`) ??
  "0x0000000000000000000000000000000000000000";

export const CHAIN_ID = 10143 as const; // Monad Testnet

// ── Enums (mirror Solidity enum values exactly) ───────────────────────────────

export enum GameState {
  WAITING  = 0,
  COMMIT   = 1,
  REVEAL   = 2,
  FLAGGING = 3,
  SCORING  = 4,
  COMPLETE = 5,
}

export const GAME_STATE_LABELS: Record<GameState, string> = {
  [GameState.WAITING]:  "Waiting for players",
  [GameState.COMMIT]:   "Submit answers",
  [GameState.REVEAL]:   "Reveal answers",
  [GameState.FLAGGING]: "Flag bad answers",
  [GameState.SCORING]:  "Round scored",
  [GameState.COMPLETE]: "Game over",
};

export enum Category {
  PERSON = 0,
  PLACE  = 1,
  THING  = 2,
  ANIMAL = 3,
  FOOD   = 4,
}

export const CATEGORY_LABELS: Record<Category, string> = {
  [Category.PERSON]: "Person",
  [Category.PLACE]:  "Place",
  [Category.THING]:  "Thing",
  [Category.ANIMAL]: "Animal",
  [Category.FOOD]:   "Food",
};

export const CATEGORY_PLACEHOLDERS: Record<Category, string> = {
  [Category.PERSON]: "e.g. Moses",
  [Category.PLACE]:  "e.g. Morocco",
  [Category.THING]:  "e.g. Mirror",
  [Category.ANIMAL]: "e.g. Monkey",
  [Category.FOOD]:   "e.g. Mango",
};

// ── TypeScript types for on-chain structs ─────────────────────────────────────

export type PlayerData = {
  addr:         `0x${string}`;
  totalScore:   bigint;
  roundScore:   bigint;
  isActive:     boolean;
  hasCommitted: boolean;
  hasRevealed:  boolean;
};

export type CommitData = {
  commitHash:      `0x${string}`;
  commitTimestamp: bigint;
  committed:       boolean;
};

export type RoundData = {
  letter:            number;   // 0='A' … 25='Z'
  commitDeadline:    bigint;   // Unix timestamp seconds
  revealDeadline:    bigint;
  flagDeadline:      bigint;
  activePlayerCount: number;
};

export type GameData = {
  id:           bigint;
  admin:        `0x${string}`;
  prizePool:    bigint;
  state:        GameState;
  currentRound: number;
  playerCount:  number;
  winner:       `0x${string}`;
  exists:       boolean;
};

export type Scoreboard = {
  addrs:        readonly `0x${string}`[];
  roundScores:  readonly bigint[];
  totalScores:  readonly bigint[];
  activeStatus: readonly boolean[];
};

// ── Game constants (match Solidity) ──────────────────────────────────────────

export const COMMIT_DURATION = 35;   // seconds
export const REVEAL_DURATION = 60;   // seconds
export const FLAG_DURATION   = 30;   // seconds
export const UNIQUE_POINTS   = 20n;
export const SHARED_POINTS   = 10n;
export const MAX_PLAYERS     = 16;
export const NUM_CATEGORIES  = 5;

// ── Full ABI ──────────────────────────────────────────────────────────────────
// Derived from contracts/src/ICallOn.sol — keep in sync after any contract changes.
// `as const` enables wagmi v2 full type inference on all hook calls.

export const ICALLON_ABI = [

  // ── Admin write functions ──────────────────────────────────────────────────

  {
    name: "createGame",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [{ name: "gameId", type: "uint256" }],
  },
  {
    name: "startRound",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "openReveal",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "openFlagging",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "scoreRound",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "emergencyWithdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [],
  },

  // ── Player write functions ─────────────────────────────────────────────────

  {
    name: "joinGame",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "commitAnswers",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "gameId",     type: "uint256" },
      { name: "commitHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "revealAnswers",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "gameId",  type: "uint256" },
      { name: "answers", type: "string[5]" },
      { name: "salt",    type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "flagAnswer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "gameId",        type: "uint256" },
      { name: "flaggedPlayer", type: "address" },
      { name: "category",      type: "uint8"   },
    ],
    outputs: [],
  },

  // ── View functions ─────────────────────────────────────────────────────────

  {
    name: "getCurrentLetter",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [{ name: "", type: "bytes1" }],
  },
  {
    name: "getActivePlayers",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [{ name: "active", type: "address[]" }],
  },
  {
    name: "getPlayer",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "gameId", type: "uint256" },
      { name: "player", type: "address" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "addr",         type: "address" },
          { name: "totalScore",   type: "uint256" },
          { name: "roundScore",   type: "uint256" },
          { name: "isActive",     type: "bool"    },
          { name: "hasCommitted", type: "bool"    },
          { name: "hasRevealed",  type: "bool"    },
        ],
      },
    ],
  },
  {
    name: "getRevealedAnswers",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "gameId", type: "uint256" },
      { name: "round",  type: "uint8"   },
      { name: "player", type: "address" },
    ],
    outputs: [
      { name: "answers",  type: "string[5]" },
      { name: "revealed", type: "bool"      },
    ],
  },
  {
    name: "getCommitData",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "gameId", type: "uint256" },
      { name: "round",  type: "uint8"   },
      { name: "player", type: "address" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "commitHash",      type: "bytes32" },
          { name: "commitTimestamp", type: "uint256" },
          { name: "committed",       type: "bool"    },
        ],
      },
    ],
  },
  {
    name: "getFlagCount",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "gameId",   type: "uint256" },
      { name: "round",    type: "uint8"   },
      { name: "player",   type: "address" },
      { name: "category", type: "uint8"   },
    ],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "hasFlagged",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "gameId",        type: "uint256" },
      { name: "round",         type: "uint8"   },
      { name: "flaggedPlayer", type: "address" },
      { name: "category",      type: "uint8"   },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getScoreboard",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [
      { name: "addrs",        type: "address[]" },
      { name: "roundScores",  type: "uint256[]" },
      { name: "totalScores",  type: "uint256[]" },
      { name: "activeStatus", type: "bool[]"    },
    ],
  },
  {
    name: "getRoundTiming",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [
      { name: "commitDeadline", type: "uint256" },
      { name: "revealDeadline", type: "uint256" },
      { name: "flagDeadline",   type: "uint256" },
    ],
  },
  {
    name: "getRoundData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "letter",            type: "uint8"   },
          { name: "commitDeadline",    type: "uint256" },
          { name: "revealDeadline",    type: "uint256" },
          { name: "flagDeadline",      type: "uint256" },
          { name: "activePlayerCount", type: "uint8"   },
        ],
      },
    ],
  },

  // ── Public mapping getters ─────────────────────────────────────────────────

  {
    name: "gameCounter",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    // games(uint256) — returns Game struct as tuple
    name: "games",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [
      { name: "id",           type: "uint256" },
      { name: "admin",        type: "address" },
      { name: "prizePool",    type: "uint256" },
      { name: "state",        type: "uint8"   }, // GameState enum → uint8
      { name: "currentRound", type: "uint8"   },
      { name: "playerCount",  type: "uint8"   },
      { name: "winner",       type: "address" },
      { name: "exists",       type: "bool"    },
    ],
  },
  {
    // players(uint256, uint8) — returns PlayerData struct as tuple
    name: "players",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "gameId", type: "uint256" },
      { name: "slot",   type: "uint8"   },
    ],
    outputs: [
      { name: "addr",         type: "address" },
      { name: "totalScore",   type: "uint256" },
      { name: "roundScore",   type: "uint256" },
      { name: "isActive",     type: "bool"    },
      { name: "hasCommitted", type: "bool"    },
      { name: "hasRevealed",  type: "bool"    },
    ],
  },
  {
    name: "playerSlot",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "gameId", type: "uint256" },
      { name: "player", type: "address" },
    ],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "isPlayer",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "gameId", type: "uint256" },
      { name: "player", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "hasRevealed",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "gameId", type: "uint256" },
      { name: "round",  type: "uint8"   },
      { name: "player", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "flagCounts",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "gameId",   type: "uint256" },
      { name: "round",    type: "uint8"   },
      { name: "player",   type: "address" },
      { name: "category", type: "uint8"   },
    ],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "playerFlaggedAnswer",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "gameId",        type: "uint256" },
      { name: "round",         type: "uint8"   },
      { name: "flagger",       type: "address" },
      { name: "flaggedPlayer", type: "address" },
      { name: "category",      type: "uint8"   },
    ],
    outputs: [{ name: "", type: "bool" }],
  },

  // ── Events ─────────────────────────────────────────────────────────────────

  {
    name: "GameCreated",
    type: "event",
    inputs: [
      { name: "gameId",    type: "uint256", indexed: true  },
      { name: "admin",     type: "address", indexed: true  },
      { name: "prizePool", type: "uint256", indexed: false },
    ],
  },
  {
    name: "PlayerJoined",
    type: "event",
    inputs: [
      { name: "gameId",      type: "uint256", indexed: true  },
      { name: "player",      type: "address", indexed: true  },
      { name: "playerCount", type: "uint8",   indexed: false },
    ],
  },
  {
    name: "RoundStarted",
    type: "event",
    inputs: [
      { name: "gameId",        type: "uint256", indexed: true  },
      { name: "round",         type: "uint8",   indexed: true  },
      { name: "letter",        type: "bytes1",  indexed: false },
      { name: "commitDeadline",type: "uint256", indexed: false },
    ],
  },
  {
    name: "PhaseAdvanced",
    type: "event",
    inputs: [
      { name: "gameId",   type: "uint256", indexed: true  },
      { name: "newState", type: "uint8",   indexed: false }, // GameState enum → uint8
    ],
  },
  {
    name: "AnswerCommitted",
    type: "event",
    inputs: [
      { name: "gameId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "round",  type: "uint8",   indexed: true },
    ],
  },
  {
    name: "AnswerRevealed",
    type: "event",
    inputs: [
      { name: "gameId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "round",  type: "uint8",   indexed: true },
    ],
  },
  {
    name: "AnswerFlagged",
    type: "event",
    inputs: [
      { name: "gameId",        type: "uint256", indexed: true  },
      { name: "flagger",       type: "address", indexed: true  },
      { name: "flaggedPlayer", type: "address", indexed: true  },
      { name: "round",         type: "uint8",   indexed: false },
      { name: "category",      type: "uint8",   indexed: false },
    ],
  },
  {
    name: "RoundScored",
    type: "event",
    inputs: [
      { name: "gameId",    type: "uint256",   indexed: true  },
      { name: "round",     type: "uint8",     indexed: true  },
      { name: "advancing", type: "address[]", indexed: false },
      { name: "eliminated",type: "address[]", indexed: false },
    ],
  },
  {
    name: "GameComplete",
    type: "event",
    inputs: [
      { name: "gameId", type: "uint256", indexed: true  },
      { name: "winner", type: "address", indexed: true  },
      { name: "prize",  type: "uint256", indexed: false },
    ],
  },

  // ── Custom errors ──────────────────────────────────────────────────────────

  { name: "GameNotFound",        type: "error", inputs: [] },
  { name: "GameFull",            type: "error", inputs: [] },
  { name: "AlreadyJoined",       type: "error", inputs: [] },
  { name: "NotAdmin",            type: "error", inputs: [] },
  { name: "NotPlayer",           type: "error", inputs: [] },
  {
    name: "WrongState",
    type: "error",
    inputs: [
      { name: "expected", type: "uint8" }, // GameState
      { name: "actual",   type: "uint8" }, // GameState
    ],
  },
  { name: "CommitWindowClosed",  type: "error", inputs: [] },
  { name: "RevealWindowClosed",  type: "error", inputs: [] },
  { name: "FlagWindowClosed",    type: "error", inputs: [] },
  { name: "DeadlineNotPassed",   type: "error", inputs: [] },
  { name: "AlreadyCommitted",    type: "error", inputs: [] },
  { name: "NotCommitted",        type: "error", inputs: [] },
  { name: "AlreadyRevealed",     type: "error", inputs: [] },
  { name: "HashMismatch",        type: "error", inputs: [] },
  {
    name: "InvalidAnswerLetter",
    type: "error",
    inputs: [
      { name: "category", type: "uint8"  },
      { name: "expected", type: "bytes1" },
    ],
  },
  { name: "AlreadyFlagged",      type: "error", inputs: [] },
  { name: "CannotFlagSelf",      type: "error", inputs: [] },
  { name: "PlayerNotActive",     type: "error", inputs: [] },
  { name: "PlayerHasNotRevealed",type: "error", inputs: [] },
  { name: "NotEnoughPlayers",    type: "error", inputs: [] },
  { name: "InsufficientPrize",   type: "error", inputs: [] },
  { name: "TransferFailed",      type: "error", inputs: [] },
  { name: "InvalidCategory",     type: "error", inputs: [] },

  // ── Fallback ───────────────────────────────────────────────────────────────
  { type: "receive", stateMutability: "payable" },

] as const;

// ── Convenience re-export for wagmi hooks ──────────────────────────────────────
// Usage:
//   import { CONTRACT } from "@/lib/contract"
//   useReadContract({ ...CONTRACT, functionName: "getPlayer", args: [gameId, address] })
export const CONTRACT = {
  address: CONTRACT_ADDRESS,
  abi:     ICALLON_ABI,
} as const;

// ── Error name → human-readable message map ────────────────────────────────────
// Used by hooks to surface friendly error messages in the UI.
export const CONTRACT_ERRORS: Record<string, string> = {
  GameNotFound:         "Game not found",
  GameFull:             "Game is full (16 players max)",
  AlreadyJoined:        "You've already joined this game",
  NotAdmin:             "Only the game admin can do this",
  NotPlayer:            "You're not in this game",
  WrongState:           "Action not allowed in current game phase",
  CommitWindowClosed:   "The 35-second answer window has closed",
  RevealWindowClosed:   "The reveal window has closed",
  FlagWindowClosed:     "The flagging window has closed",
  DeadlineNotPassed:    "The deadline hasn't passed yet",
  AlreadyCommitted:     "You've already submitted your answers",
  NotCommitted:         "You didn't commit answers this round",
  AlreadyRevealed:      "You've already revealed your answers",
  HashMismatch:         "Your revealed answers don't match your commit",
  InvalidAnswerLetter:  "Answer must start with the round letter",
  AlreadyFlagged:       "You've already flagged this answer",
  CannotFlagSelf:       "You can't flag your own answers",
  PlayerNotActive:      "That player has been eliminated",
  PlayerHasNotRevealed: "That player hasn't revealed yet",
  NotEnoughPlayers:     "Need 16 players to start",
  InsufficientPrize:    "Prize pool must be greater than 0",
  TransferFailed:       "Prize transfer failed",
  InvalidCategory:      "Invalid category (must be 0–4)",
};
