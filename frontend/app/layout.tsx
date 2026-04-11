"use client";

/**
 * layout.tsx — Root layout for ICallOn
 *
 * Responsibilities:
 *  1. Load Inter font via next/font (zero-layout-shift, self-hosted by Next.js)
 *  2. Set up CSS custom properties for the Notion-inspired design system
 *  3. Wrap the app in RainbowKit + wagmi + TanStack Query providers
 *  4. Inject RainbowKit's required stylesheet
 *  5. Apply global Tailwind base styles
 *
 * WHY "use client" on the root layout:
 *   RainbowKit's WagmiProvider and QueryClientProvider are client-only React
 *   context providers. Next.js App Router requires components using context
 *   to be client components. We keep the layout lean — no data fetching here.
 */

import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";

import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Inter } from "next/font/google";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";

// ── Inter font ────────────────────────────────────────────────────────────────
// Falls back to system sans-serif if Google Fonts is unreachable (no-op error)
const inter = Inter({
  subsets:  ["latin"],
  variable: "--font-inter",
  display:  "swap",
});

// ── RainbowKit dark theme override (Notion-style) ────────────────────────────
// We skin RainbowKit's modal to match our #0F0F0F / #1A1A1A / #008751 palette
// instead of its default purple/blue.
const rainbowTheme = darkTheme({
  accentColor:          "#008751", // Nigerian green
  accentColorForeground: "#FFFFFF",
  borderRadius:          "medium",
  fontStack:             "system",
  overlayBlur:           "small",
});

// Override specific tokens that darkTheme doesn't expose directly
const customTheme = {
  ...rainbowTheme,
  colors: {
    ...rainbowTheme.colors,
    modalBackground:      "#1A1A1A",
    modalBorder:          "#2D2D2D",
    modalText:            "#FFFFFF",
    modalTextDim:         "#9B9B9B",
    menuItemBackground:   "#2D2D2D",
    profileForeground:    "#1A1A1A",
    selectedOptionBorder: "#008751",
    actionButtonBorder:   "#2D2D2D",
    actionButtonBorderMobile: "#2D2D2D",
    generalBorder:        "#2D2D2D",
    generalBorderDim:     "#2D2D2D",
  },
} as const;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // QueryClient instantiated inside the component to ensure it's per-request
  // in SSR and not shared across users. useState ensures one instance per mount.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Monad finalizes in 0.4s — stale data becomes a problem fast.
            // 4s stale time means most reads are fresh without hammering the RPC.
            staleTime: 4_000,
            // Retry once on failure — RPC blips are common on testnets
            retry: 1,
          },
        },
      })
  );

  return (
    <html lang="en" className={inter.variable}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0F0F0F" />
        <title>ICallOn — Nigerian Word Game on Monad</title>
        <meta
          name="description"
          content="The classic Nigerian I Call On word game, on-chain. Built for Monad Blitz Lagos."
        />
        {/* Favicon — green circle, minimal */}
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body className="bg-[#0F0F0F] text-white antialiased">
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            <RainbowKitProvider theme={customTheme} locale="en-US">
              {/* Global layout shell */}
              <div className="min-h-screen flex flex-col">
                {children}
              </div>
            </RainbowKitProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </body>
    </html>
  );
}
