"use client";

import {
  ArrowRight01Icon,
  Clock01Icon,
  Copy01Icon,
  GameController01Icon,
  InformationCircleIcon,
  Login02Icon,
  Tick01Icon,
  Award01Icon,
  UserGroupIcon,
  Wallet01Icon,
} from "@hugeicons/react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { CONTRACT, GAME_STATE_LABELS, GameState } from "@/lib/contract";
import { cn, formatAddress, formatMON, getErrorMessage } from "@/lib/utils";
import { monadTestnet } from "@/lib/wagmi";

// ── Recent game row ───────────────────────────────────────────────────────────
function RecentGameRow({
  gameId,
  onClick,
}: {
  gameId: bigint;
  onClick: () => void;
}) {
  const { data: game } = useReadContract({
    ...CONTRACT,
    functionName: "games",
    args: [gameId],
  });

  if (!game || !game[7]) return null; // game.exists = false

  const [, admin, prizePool, stateRaw, , playerCount] = game;
  const state = stateRaw as GameState;

  const stateColors: Record<GameState, string> = {
    [GameState.WAITING]:  "text-[#DFAB01]",
    [GameState.COMMIT]:   "text-[#008751]",
    [GameState.REVEAL]:   "text-[#008751]",
    [GameState.FLAGGING]: "text-[#008751]",
    [GameState.SCORING]:  "text-[#9B9B9B]",
    [GameState.COMPLETE]: "text-[#9B9B9B]",
  };

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-4 py-3 row-hover group text-left"
    >
      <div className="flex items-center gap-3">
        <span className="text-sm font-mono text-[#9B9B9B]">#{gameId.toString()}</span>
        <span className={cn("text-sm", stateColors[state])}>
          {GAME_STATE_LABELS[state]}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-[#9B9B9B] hidden sm:block">
          {formatAddress(admin)} · {formatMON(prizePool)}
        </span>
        <span className="text-sm text-[#9B9B9B]">
          {playerCount}/16
        </span>
        <ArrowRight01Icon
          size={16}
          className="text-[#9B9B9B] group-hover:text-white transition-colors duration-150"
        />
      </div>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function HomePage() {
  const router = useRouter();
  const { address, isConnected, chain } = useAccount();

  // ── Create game state ─────────────────────────────────────────────────────
  const [prizeInput, setPrizeInput] = useState("1");
  const [createError, setCreateError] = useState("");
  const [createdGameId, setCreatedGameId] = useState<bigint | null>(null);
  const [copied, setCopied] = useState(false);

  const {
    writeContract: writeCreate,
    data:          createTxHash,
    isPending:     isCreatePending,
    error:         createWriteError,
    reset:         resetCreate,
  } = useWriteContract();

  const { isLoading: isCreateConfirming, isSuccess: isCreateSuccess, data: createReceipt } =
    useWaitForTransactionReceipt({ hash: createTxHash });

  // Extract the gameId from the GameCreated event log
  useEffect(() => {
    if (!isCreateSuccess || !createReceipt) return;
    // GameCreated event topic[1] = gameId (first indexed param)
    for (const log of createReceipt.logs) {
      const topic = log.topics[1];
      if (topic) {
        try {
          const id = BigInt(topic);
          if (id > 0n) {
            setCreatedGameId(id);
            break;
          }
        } catch {}
      }
    }
  }, [isCreateSuccess, createReceipt]);

  function handleCreate() {
    setCreateError("");
    resetCreate();

    const prize = parseFloat(prizeInput);
    if (isNaN(prize) || prize <= 0) {
      setCreateError("Enter a valid prize amount");
      return;
    }

    const prizeWei = BigInt(Math.floor(prize * 1e18));

    writeCreate({
      ...CONTRACT,
      functionName: "createGame",
      value: prizeWei,
    });
  }

  // Surface write errors
  useEffect(() => {
    if (createWriteError) {
      setCreateError(getErrorMessage(createWriteError));
    }
  }, [createWriteError]);

  // ── Join game state ───────────────────────────────────────────────────────
  const [joinId, setJoinId] = useState("");
  const [joinError, setJoinError] = useState("");

  function handleJoin() {
    setJoinError("");
    const id = parseInt(joinId.trim());
    if (isNaN(id) || id <= 0) {
      setJoinError("Enter a valid game ID");
      return;
    }
    router.push(`/lobby/${id}`);
  }

  // ── Recent games list ─────────────────────────────────────────────────────
  const { data: gameCounter } = useReadContract({
    ...CONTRACT,
    functionName: "gameCounter",
  });

  // Show up to last 5 games
  const recentIds: bigint[] = [];
  if (gameCounter && gameCounter > 0n) {
    const start = gameCounter > 5n ? gameCounter - 4n : 1n;
    for (let i = gameCounter; i >= start; i--) {
      recentIds.push(i);
    }
  }

  // ── Wrong network warning ─────────────────────────────────────────────────
  const isWrongNetwork = isConnected && chain?.id !== monadTestnet.id;

  // ── Copy game link ────────────────────────────────────────────────────────
  function copyGameLink(id: bigint) {
    const url = `${window.location.origin}/lobby/${id}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F]">

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav className="border-b border-[#2D2D2D] sticky top-0 z-50 bg-[#0F0F0F]/95 backdrop-blur-sm">
        <div className="game-container flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <GameController01Icon size={22} className="text-[#008751]" />
            <span className="font-semibold text-white tracking-tight">
              I Call On
            </span>
            <span className="hidden sm:block text-xs text-[#9B9B9B] border border-[#2D2D2D] rounded px-1.5 py-0.5">
              Monad Testnet
            </span>
          </div>
          <ConnectButton
            accountStatus="avatar"
            chainStatus="icon"
            showBalance={false}
          />
        </div>
      </nav>

      <main className="game-container py-12 space-y-10">

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#008751] font-medium uppercase tracking-wider">
              Monad Blitz Lagos
            </span>
            <span className="text-[#2D2D2D]">·</span>
            <span className="text-xs text-[#9B9B9B]">Hackathon Demo</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight leading-tight">
            I Call On
          </h1>
          <p className="text-[#9B9B9B] text-lg max-w-lg leading-relaxed">
            The classic Nigerian word game — on-chain. A random letter is chosen,
            you have{" "}
            <span className="text-white">35 seconds</span> to fill in 5 categories.
            Unique answers score more. Last player standing wins the prize pool.
          </p>

          {/* Stats row */}
          <div className="flex flex-wrap gap-6 pt-2">
            {[
              { icon: <UserGroupIcon size={16} />, label: "16 players" },
              { icon: <Clock01Icon   size={16} />, label: "35s per round" },
              { icon: <Award01Icon  size={16} />, label: "4 rounds to win" },
            ].map(({ icon, label }) => (
              <div key={label} className="flex items-center gap-2 text-[#9B9B9B] text-sm">
                <span className="text-[#9B9B9B]">{icon}</span>
                {label}
              </div>
            ))}
          </div>
        </section>

        {/* ── Wrong network banner ───────────────────────────────────────── */}
        {isWrongNetwork && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-[8px] bg-[#DFAB01]/10 border border-[#DFAB01]/30 text-[#DFAB01] text-sm">
            <InformationCircleIcon size={16} className="shrink-0" />
            <span>
              Wrong network. Switch to{" "}
              <strong>Monad Testnet</strong> (Chain ID: 10143) to play.
            </span>
          </div>
        )}

        {/* ── Not connected banner ───────────────────────────────────────── */}
        {!isConnected && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-[8px] bg-[#1A1A1A] border border-[#2D2D2D] text-[#9B9B9B] text-sm">
            <Wallet01Icon size={16} className="shrink-0 text-[#008751]" />
            <span>Connect your wallet to create or join a game.</span>
          </div>
        )}

        {/* ── Action cards ──────────────────────────────────────────────── */}
        <div className="grid sm:grid-cols-2 gap-4">

          {/* Create game card */}
          <div className="card p-6 space-y-5">
            <div className="space-y-1">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-[6px] bg-[#008751]/10 flex items-center justify-center">
                  <GameController01Icon size={16} className="text-[#008751]" />
                </div>
                <h2 className="font-semibold text-white">Create Game</h2>
              </div>
              <p className="text-sm text-[#9B9B9B] leading-relaxed">
                Admin creates the game and deposits the MON prize pool.
                Share the game ID with 15 other players.
              </p>
            </div>

            {/* Created success state */}
            {createdGameId ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-[#0F7B6C] text-sm">
                  <Tick01Icon size={16} />
                  <span>Game #{createdGameId.toString()} created!</span>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-[6px] bg-[#0F0F0F] border border-[#2D2D2D]">
                  <span className="text-sm text-[#9B9B9B] font-mono flex-1 truncate">
                    /lobby/{createdGameId.toString()}
                  </span>
                  <button
                    onClick={() => copyGameLink(createdGameId)}
                    className="btn-icon shrink-0"
                    title="Copy lobby link"
                  >
                    {copied
                      ? <Tick01Icon size={14} className="text-[#008751]" />
                      : <Copy01Icon size={14} />
                    }
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => router.push(`/lobby/${createdGameId}`)}
                    className="btn-primary flex-1"
                  >
                    Go to Lobby
                    <ArrowRight01Icon size={16} />
                  </button>
                  <button
                    onClick={() => {
                      setCreatedGameId(null);
                      resetCreate();
                    }}
                    className="btn-secondary"
                  >
                    New
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Prize pool input */}
                <div className="space-y-1.5">
                  <label className="label">Prize Pool (MON)</label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0.01"
                      step="0.1"
                      value={prizeInput}
                      onChange={(e) => {
                        setPrizeInput(e.target.value);
                        setCreateError("");
                      }}
                      placeholder="1.0"
                      className={cn(
                        "input pr-14",
                        createError && "input-error"
                      )}
                      disabled={!isConnected || isCreatePending || isCreateConfirming}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#9B9B9B] pointer-events-none">
                      MON
                    </span>
                  </div>
                  {createError && (
                    <p className="text-xs text-[#E03E3E]">{createError}</p>
                  )}
                </div>

                <button
                  onClick={handleCreate}
                  disabled={!isConnected || isCreatePending || isCreateConfirming || isWrongNetwork}
                  className="btn-primary w-full"
                >
                  {isCreatePending ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Confirm in wallet…
                    </>
                  ) : isCreateConfirming ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {/* Monad confirms in ~0.4s — this spinner barely shows */}
                      Confirming…
                    </>
                  ) : (
                    <>
                      Create Game
                      <ArrowRight01Icon size={16} />
                    </>
                  )}
                </button>

                {!isConnected && (
                  <p className="text-xs text-[#9B9B9B] text-center">
                    Connect wallet to create a game
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Join game card */}
          <div className="card p-6 space-y-5">
            <div className="space-y-1">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-[6px] bg-[#2D2D2D] flex items-center justify-center">
                  <Login02Icon size={16} className="text-[#9B9B9B]" />
                </div>
                <h2 className="font-semibold text-white">Join Game</h2>
              </div>
              <p className="text-sm text-[#9B9B9B] leading-relaxed">
                Got a game ID from the admin? Enter it below to join the lobby.
                Free to join — no entry fee on testnet.
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="label">Game ID</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={joinId}
                  onChange={(e) => {
                    setJoinId(e.target.value);
                    setJoinError("");
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                  placeholder="e.g. 1"
                  className={cn("input", joinError && "input-error")}
                  disabled={!isConnected}
                />
                {joinError && (
                  <p className="text-xs text-[#E03E3E]">{joinError}</p>
                )}
              </div>

              <button
                onClick={handleJoin}
                disabled={!isConnected || !joinId || isWrongNetwork}
                className="btn-primary w-full"
              >
                Join Lobby
                <ArrowRight01Icon size={16} />
              </button>

              {!isConnected && (
                <p className="text-xs text-[#9B9B9B] text-center">
                  Connect wallet to join a game
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── How to play ───────────────────────────────────────────────── */}
        <section className="card divide-y divide-[#2D2D2D]">
          <div className="px-6 py-4">
            <h3 className="font-medium text-white">How it works</h3>
          </div>
          {[
            {
              step: "01",
              title: "A random letter is chosen on-chain",
              desc: "The contract uses block.prevrandao for randomness — refreshed every ~0.4s on Monad.",
            },
            {
              step: "02",
              title: "35 seconds to fill 5 categories",
              desc: "Person, Place, Thing, Animal, Food — all starting with that letter.",
            },
            {
              step: "03",
              title: "Submit a hash, then reveal",
              desc: "Answers are committed as a hash first. No one can copy you. Reveal after the window closes.",
            },
            {
              step: "04",
              title: "Flag bad answers",
              desc: "30-second window to flag invalid answers. 50%+ flags = 0 pts for that answer.",
            },
            {
              step: "05",
              title: "Top half advances",
              desc: "Unique answers = 20pts. Shared = 10pts. Bottom half eliminated. 4 rounds → 1 winner.",
            },
          ].map(({ step, title, desc }) => (
            <div key={step} className="px-6 py-4 flex gap-4">
              <span className="text-xs font-mono text-[#9B9B9B] pt-0.5 w-6 shrink-0">
                {step}
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium text-white">{title}</p>
                <p className="text-sm text-[#9B9B9B]">{desc}</p>
              </div>
            </div>
          ))}
        </section>

        {/* ── Recent games ──────────────────────────────────────────────── */}
        {recentIds.length > 0 && (
          <section className="card divide-y divide-[#2D2D2D]">
            <div className="px-6 py-4 flex items-center justify-between">
              <h3 className="font-medium text-white">Recent Games</h3>
              {gameCounter && (
                <span className="text-xs text-[#9B9B9B]">
                  {gameCounter.toString()} total
                </span>
              )}
            </div>
            <div className="px-2 py-2">
              {recentIds.map((id) => (
                <RecentGameRow
                  key={id.toString()}
                  gameId={id}
                  onClick={() => router.push(`/lobby/${id}`)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Connected wallet info ─────────────────────────────────────── */}
        {isConnected && address && (
          <section className="flex items-center justify-between px-4 py-3 card text-sm">
            <div className="flex items-center gap-2">
              <span className="status-dot status-dot-active" />
              <span className="text-[#9B9B9B]">Connected as</span>
              <span className="font-mono text-white">{formatAddress(address)}</span>
            </div>
            <span className="text-xs text-[#9B9B9B]">
              {chain?.name ?? "Unknown network"}
            </span>
          </section>
        )}

      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-[#2D2D2D] mt-16">
        <div className="game-container py-6 flex items-center justify-between text-xs text-[#9B9B9B]">
          <span>Built for Monad Blitz Lagos · 2025</span>
          <a
            href={`https://testnet.monadexplorer.com/address/${CONTRACT.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white transition-colors duration-150 font-mono"
          >
            {formatAddress(CONTRACT.address)}
          </a>
        </div>
      </footer>
    </div>
  );
}
