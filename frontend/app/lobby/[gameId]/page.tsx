"use client";

import {
  ArrowRight01Icon,
  Copy01Icon,
  CrownIcon,
  GameController01Icon,
  InformationCircleIcon,
  Loading03Icon,
  Logout01Icon,
  RefreshIcon,
  Tick01Icon,
  Timer01Icon,
  Award01Icon,
  UserCircle02Icon,
  UserGroupIcon,
} from "@hugeicons/react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { AnimatePresence, motion } from "framer-motion";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import {
  useActivePlayers,
  useAllPlayerData,
  useGameData,
  useIsPlayer,
  useJoinGame,
  useMyGameStatus,
  useStartRound,
} from "@/hooks/useICallOn";
import { useOnPlayerJoined, useOnRoundStarted } from "@/hooks/useGameEvents";
import { GameState } from "@/lib/contract";
import { cn, formatAddress, formatMON, roundLabel } from "@/lib/utils";

// ── Player card component ─────────────────────────────────────────────────────
function PlayerCard({
  address,
  index,
  isYou,
  isAdmin,
}: {
  address: `0x${string}`;
  index:   number;
  isYou:   boolean;
  isAdmin: boolean;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-[8px] border",
        isYou
          ? "bg-[#008751]/10 border-[#008751]/30"
          : "bg-[#1A1A1A] border-[#2D2D2D]"
      )}
    >
      {/* Avatar circle */}
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-mono font-medium",
          isYou ? "bg-[#008751]/20 text-[#008751]" : "bg-[#2D2D2D] text-[#9B9B9B]"
        )}
      >
        {address.slice(2, 4).toUpperCase()}
      </div>

      {/* Address */}
      <span className={cn(
        "font-mono text-sm flex-1 truncate",
        isYou ? "text-white" : "text-[#9B9B9B]"
      )}>
        {formatAddress(address, 5)}
      </span>

      {/* Badges */}
      <div className="flex items-center gap-1.5 shrink-0">
        {isAdmin && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-[#DFAB01] border border-[#DFAB01]/30 rounded px-1.5 py-0.5">
            <CrownIcon size={10} />
            Admin
          </span>
        )}
        {isYou && (
          <span className="text-[10px] font-medium text-[#008751] border border-[#008751]/30 rounded px-1.5 py-0.5">
            You
          </span>
        )}
        {/* Slot number */}
        <span className="text-[10px] text-[#9B9B9B] font-mono w-5 text-right">
          #{index + 1}
        </span>
      </div>
    </motion.div>
  );
}

// ── Empty slot component ──────────────────────────────────────────────────────
function EmptySlot({ index }: { index: number }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-[8px] border border-dashed border-[#2D2D2D] opacity-40">
      <div className="w-8 h-8 rounded-full bg-[#2D2D2D] flex items-center justify-center shrink-0">
        <UserCircle02Icon size={16} className="text-[#9B9B9B]" />
      </div>
      <span className="text-sm text-[#9B9B9B]">Waiting…</span>
      <span className="ml-auto text-[10px] text-[#9B9B9B] font-mono">
        #{index + 1}
      </span>
    </div>
  );
}

// ── Main lobby page ───────────────────────────────────────────────────────────
export default function LobbyPage() {
  const params  = useParams();
  const router  = useRouter();
  const gameId  = BigInt(params.gameId as string);

  const { address, isConnected } = useAccount();

  // ── Contract reads ────────────────────────────────────────────────────────
  const { game, isLoading: gameLoading, refetch: refetchGame } = useGameData(gameId);
  const { activePlayers, refetch: refetchPlayers }             = useActivePlayers(gameId);
  const { playerList }                                          = useAllPlayerData(gameId, game?.playerCount ?? 0);
  const { isPlayer }                                            = useIsPlayer(gameId, address);
  const myStatus                                                = useMyGameStatus(gameId);

  // ── Write hooks ───────────────────────────────────────────────────────────
  const joinGame   = useJoinGame(gameId);
  const startRound = useStartRound(gameId);

  // ── Real-time events ──────────────────────────────────────────────────────
  const [recentJoins, setRecentJoins] = useState<`0x${string}`[]>([]);

  useOnPlayerJoined(gameId, useCallback((event) => {
    refetchGame();
    refetchPlayers();
    setRecentJoins((prev) => [event.player, ...prev].slice(0, 3));
    setTimeout(() => {
      setRecentJoins((prev) => prev.filter((a) => a !== event.player));
    }, 3000);
  }, [refetchGame, refetchPlayers]));

  // Navigate to game page when round starts
  useOnRoundStarted(gameId, useCallback(() => {
    router.push(`/game/${gameId}`);
  }, [gameId, router]));

  // Navigate if game is already past WAITING when page loads
  useEffect(() => {
    if (!game) return;
    if (game.state === GameState.COMMIT || game.state === GameState.REVEAL ||
        game.state === GameState.FLAGGING || game.state === GameState.SCORING) {
      router.replace(`/game/${gameId}`);
    }
    if (game.state === GameState.COMPLETE) {
      router.replace(`/results/${gameId}`);
    }
  }, [game, gameId, router]);

  // ── Clipboard copy ────────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);
  function copyLink() {
    navigator.clipboard.writeText(`${window.location.origin}/lobby/${gameId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const playerCount = game?.playerCount ?? 0;
  const isFull      = playerCount >= 16;
  const isAdmin     = myStatus.isAdmin;

  // Build 16-slot grid: filled + empty
  const slots = useMemo(() => {
    const filled = playerList.map((p, i) => ({ address: p.addr, index: i, filled: true }));
    const empty  = Array.from({ length: Math.max(0, 16 - filled.length) }, (_, i) => ({
      address:  undefined as `0x${string}` | undefined,
      index:    filled.length + i,
      filled:   false,
    }));
    return [...filled, ...empty];
  }, [playerList]);

  // ── Start round (admin) ───────────────────────────────────────────────────
  function handleStartRound() {
    startRound.execute();
  }

  // After start round tx confirms, navigation is handled by useOnRoundStarted
  useEffect(() => {
    if (startRound.isSuccess) {
      refetchGame();
    }
  }, [startRound.isSuccess, refetchGame]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (gameLoading && !game) {
    return (
      <div className="min-h-screen bg-[#0F0F0F] flex items-center justify-center">
        <div className="flex items-center gap-3 text-[#9B9B9B]">
          <Loading03Icon size={20} className="animate-spin" />
          <span>Loading game…</span>
        </div>
      </div>
    );
  }

  if (!game?.exists) {
    return (
      <div className="min-h-screen bg-[#0F0F0F] flex items-center justify-center">
        <div className="card p-8 text-center space-y-3 max-w-sm w-full mx-4">
          <InformationCircleIcon size={32} className="text-[#9B9B9B] mx-auto" />
          <p className="text-white font-medium">Game not found</p>
          <p className="text-sm text-[#9B9B9B]">Game #{gameId.toString()} doesn't exist.</p>
          <button onClick={() => router.push("/")} className="btn-secondary w-full">
            Back to home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F]">

      {/* ── Nav ───────────────────────────────────────────────────────────── */}
      <nav className="border-b border-[#2D2D2D] sticky top-0 z-50 bg-[#0F0F0F]/95 backdrop-blur-sm">
        <div className="game-container flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/")}
              className="btn-icon"
              title="Home"
            >
              <GameController01Icon size={18} className="text-[#008751]" />
            </button>
            <span className="text-[#2D2D2D]">/</span>
            <span className="text-sm text-[#9B9B9B]">Lobby</span>
            <span className="text-[#2D2D2D]">/</span>
            <span className="text-sm font-mono text-white">#{gameId.toString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { refetchGame(); refetchPlayers(); }} className="btn-icon" title="Refresh">
              <RefreshIcon size={16} className="text-[#9B9B9B]" />
            </button>
            <ConnectButton accountStatus="avatar" chainStatus="none" showBalance={false} />
          </div>
        </div>
      </nav>

      <main className="game-container py-8 space-y-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="status-dot status-dot-active animate-pulse" />
            <span className="text-xs text-[#9B9B9B]">Waiting for players</span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white">
                Game #{gameId.toString()}
              </h1>
              <p className="text-sm text-[#9B9B9B] mt-0.5">
                Prize pool ·{" "}
                <span className="text-[#DFAB01] font-medium">
                  {formatMON(game.prizePool)}
                </span>
              </p>
            </div>

            {/* Share button */}
            <button onClick={copyLink} className="btn-secondary shrink-0">
              {copied ? (
                <>
                  <Tick01Icon size={16} className="text-[#008751]" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy01Icon size={16} />
                  Share
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── Player count progress bar ────────────────────────────────────── */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserGroupIcon size={16} className="text-[#9B9B9B]" />
              <span className="text-sm text-[#9B9B9B]">Players</span>
            </div>
            <span className="text-sm font-medium text-white">
              {playerCount}
              <span className="text-[#9B9B9B]">/16</span>
            </span>
          </div>

          {/* Segmented progress bar — 16 blocks */}
          <div className="flex gap-1">
            {Array.from({ length: 16 }, (_, i) => (
              <motion.div
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors duration-300",
                  i < playerCount ? "bg-[#008751]" : "bg-[#2D2D2D]"
                )}
                initial={false}
                animate={{ backgroundColor: i < playerCount ? "#008751" : "#2D2D2D" }}
                transition={{ duration: 0.2, delay: i < playerCount ? 0 : 0 }}
              />
            ))}
          </div>

          {isFull ? (
            <p className="text-xs text-[#008751]">
              All 16 players are in. Waiting for admin to start…
            </p>
          ) : (
            <p className="text-xs text-[#9B9B9B]">
              Need {16 - playerCount} more player{16 - playerCount !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        {/* ── Recent join toast ─────────────────────────────────────────────── */}
        <AnimatePresence>
          {recentJoins.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="flex items-center gap-2 px-3 py-2 rounded-[6px] bg-[#008751]/10 border border-[#008751]/20 text-sm text-[#008751]"
            >
              <Tick01Icon size={14} />
              <span>
                {formatAddress(recentJoins[0])} just joined!
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Join / already in game ───────────────────────────────────────── */}
        {isConnected && !isPlayer && !isFull && (
          <div className="space-y-2">
            <button
              onClick={() => joinGame.execute()}
              disabled={joinGame.isPending || joinGame.isConfirming}
              className="btn-primary w-full"
            >
              {joinGame.isPending ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Confirm in wallet…
                </>
              ) : joinGame.isConfirming ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Joining…
                </>
              ) : (
                <>
                  Join Game
                  <ArrowRight01Icon size={16} />
                </>
              )}
            </button>
            {joinGame.error && (
              <p className="text-xs text-[#E03E3E] px-1">{joinGame.error}</p>
            )}
          </div>
        )}

        {isPlayer && !isAdmin && (
          <div className="flex items-center gap-2 px-4 py-3 card text-sm">
            <Tick01Icon size={16} className="text-[#008751] shrink-0" />
            <span className="text-[#9B9B9B]">
              You're in! Waiting for the admin to start the game.
            </span>
          </div>
        )}

        {!isConnected && (
          <div className="flex items-center gap-2 px-4 py-3 card text-sm">
            <InformationCircleIcon size={16} className="text-[#9B9B9B] shrink-0" />
            <span className="text-[#9B9B9B]">Connect your wallet to join.</span>
          </div>
        )}

        {/* ── Admin controls ───────────────────────────────────────────────── */}
        {isAdmin && (
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CrownIcon size={16} className="text-[#DFAB01]" />
              <span className="text-sm font-medium text-white">Admin Controls</span>
            </div>

            <div className="space-y-2">
              <button
                onClick={handleStartRound}
                disabled={!isFull || startRound.isPending || startRound.isConfirming}
                className="btn-primary w-full"
              >
                {startRound.isPending ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Confirm in wallet…
                  </>
                ) : startRound.isConfirming ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                    <Timer01Icon size={16} />
                    Start Round 1
                    <ArrowRight01Icon size={16} />
                  </>
                )}
              </button>

              {!isFull && (
                <p className="text-xs text-[#9B9B9B] text-center">
                  Waiting for {16 - playerCount} more player{16 - playerCount !== 1 ? "s" : ""}
                </p>
              )}

              {startRound.error && (
                <p className="text-xs text-[#E03E3E]">{startRound.error}</p>
              )}
            </div>
          </div>
        )}

        {/* ── Player grid ──────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="label">Players ({playerCount}/16)</h2>
            {isAdmin && (
              <span className="text-xs text-[#9B9B9B] flex items-center gap-1">
                <Award01Icon size={12} />
                {formatMON(game.prizePool)} prize pool
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <AnimatePresence mode="popLayout">
              {slots.map((slot) =>
                slot.filled && slot.address ? (
                  <PlayerCard
                    key={slot.address}
                    address={slot.address}
                    index={slot.index}
                    isYou={!!address && slot.address.toLowerCase() === address.toLowerCase()}
                    isAdmin={!!game && slot.address.toLowerCase() === game.admin.toLowerCase()}
                  />
                ) : (
                  <EmptySlot key={`empty-${slot.index}`} index={slot.index} />
                )
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* ── Game info ────────────────────────────────────────────────────── */}
        <section className="card divide-y divide-[#2D2D2D]">
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-[#9B9B9B]">Tournament</span>
            <span className="text-sm text-white">4 rounds · 16 → 1</span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-[#9B9B9B]">Answer window</span>
            <span className="text-sm text-white">35 seconds</span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-[#9B9B9B]">Unique answer</span>
            <span className="text-sm text-[#008751] font-medium">20 pts</span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-[#9B9B9B]">Shared answer</span>
            <span className="text-sm text-[#DFAB01] font-medium">10 pts</span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-[#9B9B9B]">Prize pool</span>
            <span className="text-sm text-[#DFAB01] font-medium">{formatMON(game.prizePool)}</span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-[#9B9B9B]">Admin</span>
            <span className="text-sm font-mono text-[#9B9B9B]">{formatAddress(game.admin)}</span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-[#9B9B9B]">Network</span>
            <span className="text-sm text-white">Monad Testnet</span>
          </div>
        </section>

      </main>
    </div>
  );
}
