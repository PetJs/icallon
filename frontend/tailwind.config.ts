import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      // ── ICallOn / Notion-inspired design tokens ──────────────────────────
      colors: {
        background:   "#0F0F0F",
        surface:      "#1A1A1A",
        border:       "#2D2D2D",
        "text-primary":   "#FFFFFF",
        "text-secondary": "#9B9B9B",
        accent:       "#008751",
        "accent-hover": "#00A862",
        danger:       "#E03E3E",
        warning:      "#DFAB01",
        success:      "#0F7B6C",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "8px",
      },
      transitionDuration: {
        fast: "150ms",
      },
      maxWidth: {
        game: "720px",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.25s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%":   { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)"   },
        },
      },
    },
  },
  plugins: [],
};

export default config;
