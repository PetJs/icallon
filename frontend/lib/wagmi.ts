/**
 * wagmi.ts — Wagmi v2 + RainbowKit config for ICallOn
 *
 * ─── MONAD TESTNET ───────────────────────────────────────────────────────────
 * Chain ID  : 10143
 * RPC (HTTP): https://testnet-rpc.monad.xyz
 * RPC (WSS) : wss://testnet-rpc.monad.xyz   ← used for watchContractEvent
 * Explorer  : https://testnet.monadexplorer.com
 * Symbol    : MON
 *
 * WHY TWO TRANSPORTS (http + webSocket):
 *   wagmi's useWatchContractEvent (and viem's watchContractEvent) requires a
 *   WebSocket transport to receive real-time event push. HTTP polling works but
 *   adds 1–2s latency per poll cycle — unacceptable when Monad finalizes in 0.4s.
 *   We use fallback([webSocket, http]) so:
 *     - Event subscriptions go over WSS (push, sub-second)
 *     - Read/write calls fall back to HTTP if WSS is unavailable
 *
 * WHY viem ^2.40.0:
 *   Monad's JSON-RPC uses eth_chainId and EIP-1559 fields. viem 2.40+ correctly
 *   handles Monad's gas model without needing --legacy transaction overrides.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";
import { fallback, http, webSocket } from "viem";
import { createConfig } from "wagmi";

// ── Monad Testnet chain definition ────────────────────────────────────────────
// viem's built-in chain list doesn't include Monad Testnet yet (pre-mainnet),
// so we define it manually using defineChain.
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: {
    name: "MON",
    symbol: "MON",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http:      ["https://testnet-rpc.monad.xyz"],
      webSocket: ["wss://testnet-rpc.monad.xyz"],
    },
    public: {
      http:      ["https://testnet-rpc.monad.xyz"],
      webSocket: ["wss://testnet-rpc.monad.xyz"],
    },
  },
  blockExplorers: {
    default: {
      name: "Monad Explorer",
      url:  "https://testnet.monadexplorer.com",
    },
  },
  testnet: true,
});

// ── WalletConnect Project ID ──────────────────────────────────────────────────
// Required by RainbowKit for WalletConnect v2 (mobile wallet support).
// Get one free at https://cloud.walletconnect.com
const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

if (!walletConnectProjectId && typeof window !== "undefined") {
  console.warn(
    "[ICallOn] NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set. " +
      "WalletConnect (mobile wallets) will not work. " +
      "Get a free project ID at https://cloud.walletconnect.com"
  );
}

// ── wagmi config via RainbowKit's getDefaultConfig ───────────────────────────
// getDefaultConfig wires up wagmi + RainbowKit + react-query in one call.
// We override the transport to use fallback([webSocket, http]) for Monad
// so that real-time event watching uses WSS push instead of HTTP polling.
export const wagmiConfig = getDefaultConfig({
  appName:    "ICallOn — Nigerian Word Game on Monad",
  projectId:  walletConnectProjectId,
  chains:     [monadTestnet],
  transports: {
    // fallback tries webSocket first, falls back to http if WSS drops.
    // This gives us <0.4s event latency on Monad while staying resilient.
    [monadTestnet.id]: fallback([
      webSocket("wss://testnet-rpc.monad.xyz"),
      http("https://testnet-rpc.monad.xyz"),
    ]),
  },
  ssr: true, // Next.js App Router — enable SSR-safe hydration
});

// ── Public viem client (for direct calls outside React hooks) ─────────────────
// Use this in server components, utility functions, or scripts that need
// to read chain state without going through wagmi's hook system.
import { createPublicClient } from "viem";

export const publicClient = createPublicClient({
  chain:     monadTestnet,
  transport: fallback([
    webSocket("wss://testnet-rpc.monad.xyz"),
    http("https://testnet-rpc.monad.xyz"),
  ]),
});

// ── Type exports ──────────────────────────────────────────────────────────────
export type SupportedChainId = typeof monadTestnet.id; // 10143
