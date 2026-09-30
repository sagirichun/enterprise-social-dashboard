import type { Config } from "tailwindcss";
import { fontFamily } from "tailwindcss/defaultTheme";

/**
 * Enterprise Social Dashboard - design system.
 *
 * Direction: calm, precise, premium. A slate/zinc neutral base keeps dense
 * operational UI readable; a single indigo -> violet accent carries brand
 * moments (primary actions, active states, data highlights). Surfaces use
 * layered elevation instead of heavy borders. Typography is Inter throughout
 * with tight tracking on display sizes.
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1440px" },
    },
    extend: {
      colors: {
        /* Brand accent - indigo to violet ramp */
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
          950: "#1e1b4b",
        },
        accent: {
          50: "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
          800: "#5b21b6",
          900: "#4c1d95",
          950: "#2e1065",
        },
        /* Neutral surfaces - zinc based */
        surface: {
          DEFAULT: "#ffffff",
          subtle: "#fafafa",
          muted: "#f4f4f5",
          sunken: "#e4e4e7",
        },
        ink: {
          DEFAULT: "#18181b",
          soft: "#3f3f46",
          muted: "#71717a",
          faint: "#a1a1aa",
        },
        /* Dark mode surfaces */
        night: {
          DEFAULT: "#0c0c0e",
          raised: "#131316",
          overlay: "#1a1a1e",
          line: "#26262b",
        },
        /* Platform brand colors (account badges, charts) */
        platform: {
          facebook: "#1877f2",
          instagram: "#e1306c",
          tiktok: "#010101",
          youtube: "#ff0000",
          twitter: "#1d9bf0",
          threads: "#000000",
        },
        /* Semantic */
        success: {
          50: "#ecfdf5",
          100: "#d1fae5",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
        },
        warning: {
          50: "#fffbeb",
          100: "#fef3c7",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
        },
        danger: {
          50: "#fef2f2",
          100: "#fee2e2",
          500: "#ef4444",
          600: "#dc2626",
          700: "#b91c1c",
        },
        info: {
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "ui-sans-serif", ...fontFamily.sans],
        display: ["var(--font-inter)", "Inter", "ui-sans-serif", ...fontFamily.sans],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          ...fontFamily.mono,
        ],
      },
      fontSize: {
        display: ["3rem", { lineHeight: "3.25rem", letterSpacing: "-0.02em" }],
        h1: ["1.875rem", { lineHeight: "2.25rem", letterSpacing: "-0.015em" }],
        h2: ["1.5rem", { lineHeight: "2rem", letterSpacing: "-0.01em" }],
        h3: ["1.25rem", { lineHeight: "1.75rem", letterSpacing: "-0.01em" }],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(9 9 11 / 0.04), 0 1px 3px 0 rgb(9 9 11 / 0.06)",
        "card-hover":
          "0 4px 6px -1px rgb(9 9 11 / 0.06), 0 2px 4px -2px rgb(9 9 11 / 0.06)",
        elevated:
          "0 10px 15px -3px rgb(9 9 11 / 0.08), 0 4px 6px -4px rgb(9 9 11 / 0.08)",
        popover:
          "0 20px 25px -5px rgb(9 9 11 / 0.1), 0 8px 10px -6px rgb(9 9 11 / 0.1)",
        glow: "0 0 0 1px rgb(99 102 241 / 0.15), 0 8px 24px -8px rgb(99 102 241 / 0.45)",
        inset: "inset 0 1px 2px 0 rgb(9 9 11 / 0.05)",
      },
      borderRadius: {
        xl2: "1rem",
        xl3: "1.25rem",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
        "brand-gradient-soft":
          "linear-gradient(135deg, rgb(99 102 241 / 0.08) 0%, rgb(139 92 246 / 0.08) 100%)",
        "surface-gradient": "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
        "mesh-dark":
          "radial-gradient(60% 50% at 20% 0%, rgb(99 102 241 / 0.12) 0%, transparent 100%), radial-gradient(50% 40% at 90% 10%, rgb(139 92 246 / 0.1) 0%, transparent 100%)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(1)", opacity: "0.6" },
          "100%": { transform: "scale(1.8)", opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "fade-up": "fade-up 320ms cubic-bezier(0.16, 1, 0.3, 1)",
        "scale-in": "scale-in 180ms ease-out",
        "pulse-ring": "pulse-ring 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        shimmer: "shimmer 1.8s linear infinite",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
