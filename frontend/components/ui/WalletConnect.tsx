"use client";

/**
 * WalletConnect.tsx — Custom RainbowKit connect button
 *
 * RainbowKit's <ConnectButton> is powerful but visually opinionated.
 * This component uses ConnectButton.Custom to render our own button
 * that matches the Notion design system exactly:
 *   - Same flat border style as .btn-secondary / .btn-primary
 *   - #008751 accent for connected state
 *   - Truncated address in monospace
 *   - Chain indicator with wrong-network warning
 *   - ENS name / avatar support when available
 *   - Mobile-friendly — compact mode for small screens
 *
 * Usage:
 *   <WalletConnect />           — full button (default)
 *   <WalletConnect compact />   — address only, no chain indicator
 *   <WalletConnect avatarOnly/> — circular avatar button (for tight nav)
 */

import {
  AlertCircleIcon,
  ArrowDown01Icon,
  Copy01Icon,
  Logout01Icon,
  Tick01Icon,
  Wallet01Icon,
} from "@hugeicons/react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useRef, useState } from "react";

import { cn, formatAddress } from "@/lib/utils";
import { monadTestnet } from "@/lib/wagmi";

// ── Chain pill ─────────────────────────────────────────────────────────────────
function ChainPill({
  chainName,
  isWrongNetwork,
  onClick,
}: {
  chainName:      string;
  isWrongNetwork: boolean;
  onClick:        () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] border text-xs font-medium",
        "transition-all duration-150 select-none",
        isWrongNetwork
          ? "bg-[#E03E3E]/10 border-[#E03E3E]/40 text-[#E03E3E] hover:bg-[#E03E3E]/20"
          : "bg-transparent border-[#2D2D2D] text-[#9B9B9B] hover:bg-[#2D2D2D] hover:text-white"
      )}
      title={isWrongNetwork ? "Wrong network — click to switch" : chainName}
    >
      {isWrongNetwork ? (
        <AlertCircleIcon size={12} />
      ) : (
        <span className="w-1.5 h-1.5 rounded-full bg-[#008751]" />
      )}
      <span className="hidden md:block">
        {isWrongNetwork ? "Wrong Network" : chainName}
      </span>
    </button>
  );
}

// ── Account button ─────────────────────────────────────────────────────────────
function AccountButton({
  address,
  ensName,
  ensAvatar,
  balance,
  onClick,
  compact,
}: {
  address:    string;
  ensName?:   string;
  ensAvatar?: string;
  balance?:   { formatted: string; symbol: string };
  onClick:    () => void;
  compact:    boolean;
}) {
  const displayName = ensName ?? formatAddress(address as `0x${string}`, 4);
  const initials    = address.slice(2, 4).toUpperCase();

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-[6px] border",
        "bg-transparent border-[#2D2D2D] hover:bg-[#2D2D2D]",
        "text-sm font-medium text-white transition-all duration-150 select-none"
      )}
    >
      {/* Avatar */}
      {ensAvatar ? (
        <img
          src={ensAvatar}
          alt={displayName}
          className="w-5 h-5 rounded-full object-cover"
        />
      ) : (
        <div className="w-5 h-5 rounded-full bg-[#008751]/20 flex items-center justify-center text-[9px] font-mono font-bold text-[#008751] shrink-0">
          {initials}
        </div>
      )}

      {/* Address / ENS */}
      <span className="font-mono text-xs">{displayName}</span>

      {/* Balance — hidden on compact and mobile */}
      {!compact && balance && (
        <span className="hidden lg:block text-xs text-[#9B9B9B] border-l border-[#2D2D2D] pl-2 ml-1">
          {parseFloat(balance.formatted).toFixed(2)} {balance.symbol}
        </span>
      )}

      <ArrowDown01Icon size={12} className="text-[#9B9B9B] shrink-0" />
    </button>
  );
}

// ── Connect button ─────────────────────────────────────────────────────────────
function ConnectCTA({ openConnectModal }: { openConnectModal: () => void }) {
  return (
    <button
      onClick={openConnectModal}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-[6px] border",
        "bg-[#008751] hover:bg-[#00A862] active:bg-[#007040]",
        "border-transparent text-white text-sm font-medium",
        "transition-all duration-150 select-none"
      )}
    >
      <Wallet01Icon size={15} />
      <span>Connect</span>
    </button>
  );
}

// ── Copy address dropdown ─────────────────────────────────────────────────────
function AccountDropdown({
  address,
  onCopy,
  onDisconnect,
  onClose,
  copied,
}: {
  address:      string;
  onCopy:       () => void;
  onDisconnect: () => void;
  onClose:      () => void;
  copied:       boolean;
}) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Dropdown */}
      <motion.div
        initial={{ opacity: 0, y: -6, scale: 0.97 }}
        animate={{ opacity: 1, y: 0,  scale: 1    }}
        exit={{ opacity: 0, y: -6, scale: 0.97 }}
        transition={{ duration: 0.12 }}
        className="absolute right-0 top-full mt-1.5 z-50 w-56 card shadow-lg shadow-black/40 overflow-hidden"
      >
        {/* Address display */}
        <div className="px-3 py-2.5 border-b border-[#2D2D2D]">
          <p className="text-[10px] text-[#9B9B9B] uppercase tracking-wider mb-1">
            Connected
          </p>
          <p className="text-xs font-mono text-white break-all">{address}</p>
        </div>

        {/* Actions */}
        <div className="p-1">
          <button
            onClick={onCopy}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-[6px] text-sm text-left",
              "text-[#9B9B9B] hover:bg-[#2D2D2D] hover:text-white",
              "transition-colors duration-150"
            )}
          >
            {copied
              ? <Tick01Icon size={15} className="text-[#008751]" />
              : <Copy01Icon size={15} />
            }
            {copied ? "Copied!" : "Copy address"}
          </button>

          <button
            onClick={onDisconnect}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-[6px] text-sm text-left",
              "text-[#E03E3E] hover:bg-[#E03E3E]/10",
              "transition-colors duration-150"
            )}
          >
            <Logout01Icon size={15} />
            Disconnect
          </button>
        </div>

        {/* Network info */}
        <div className="px-3 py-2 border-t border-[#2D2D2D] flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#008751]" />
          <span className="text-[10px] text-[#9B9B9B]">
            {monadTestnet.name} · Chain {monadTestnet.id}
          </span>
        </div>
      </motion.div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//                           MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
type WalletConnectProps = {
  /** Compact mode — no chain pill, smaller address */
  compact?:    boolean;
  /** Avatar-only mode — circular button, no address text */
  avatarOnly?: boolean;
  className?:  string;
};

export default function WalletConnect({
  compact    = false,
  avatarOnly = false,
  className,
}: WalletConnectProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied,       setCopied]       = useState(false);

  const handleCopy = useCallback((address: string) => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        authenticationStatus,
        mounted,
      }) => {
        // Don't render until wagmi has hydrated
        const ready = mounted && authenticationStatus !== "loading";

        if (!ready) {
          return (
            <div
              aria-hidden
              className={cn(
                "w-24 h-8 rounded-[6px] bg-[#2D2D2D] animate-pulse",
                className
              )}
            />
          );
        }

        const connected =
          ready &&
          account &&
          chain &&
          (!authenticationStatus || authenticationStatus === "authenticated");

        if (!connected) {
          return (
            <div className={cn("relative", className)}>
              <ConnectCTA openConnectModal={openConnectModal} />
            </div>
          );
        }

        const isWrongNetwork = chain.unsupported || chain.id !== monadTestnet.id;

        // ── Avatar-only mode (circular) ────────────────────────────────────
        if (avatarOnly) {
          return (
            <button
              onClick={() => setShowDropdown((v) => !v)}
              className="w-8 h-8 rounded-full bg-[#008751]/20 border border-[#008751]/30 flex items-center justify-center text-[10px] font-mono font-bold text-[#008751] transition-colors hover:bg-[#008751]/30"
            >
              {account.address.slice(2, 4).toUpperCase()}
            </button>
          );
        }

        return (
          <div className={cn("relative flex items-center gap-2", className)}>

            {/* Wrong network / chain pill */}
            {!compact && (
              <ChainPill
                chainName={chain.name ?? "Unknown"}
                isWrongNetwork={isWrongNetwork}
                onClick={openChainModal}
              />
            )}

            {/* Account button */}
            <div className="relative">
              <AccountButton
                address={account.address}
                ensName={account.ensName ?? undefined}
                ensAvatar={account.ensAvatar ?? undefined}
                balance={account.balanceFormatted ? {
                  formatted: account.balanceFormatted,
                  symbol:    "MON",
                } : undefined}
                onClick={() => setShowDropdown((v) => !v)}
                compact={compact}
              />

              {/* Dropdown */}
              <AnimatePresence>
                {showDropdown && (
                  <AccountDropdown
                    address={account.address}
                    onCopy={() => handleCopy(account.address)}
                    onDisconnect={() => {
                      setShowDropdown(false);
                      openAccountModal();
                    }}
                    onClose={() => setShowDropdown(false)}
                    copied={copied}
                  />
                )}
              </AnimatePresence>
            </div>

            {/* Wrong network badge (mobile — inline) */}
            {isWrongNetwork && (
              <button
                onClick={openChainModal}
                className="sm:hidden flex items-center gap-1 px-2 py-1.5 rounded-[6px] bg-[#E03E3E]/10 border border-[#E03E3E]/40 text-[#E03E3E] text-xs"
              >
                <AlertCircleIcon size={12} />
              </button>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
