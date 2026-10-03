import type { Config } from "tailwindcss";

/*
 * Tailwind 설정 — 색/간격 토큰은 src/styles/tokens.css 의 CSS 변수를 참조한다.
 * ui-ux-designer가 토큰을 확정하면 tokens.css 만 교체하면 되도록 간접 참조한다.
 */
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "hsl(var(--color-bg) / <alpha-value>)",
        surface: "hsl(var(--color-surface) / <alpha-value>)",
        border: "hsl(var(--color-border) / <alpha-value>)",
        fg: "hsl(var(--color-fg) / <alpha-value>)",
        muted: "hsl(var(--color-muted) / <alpha-value>)",
        primary: "hsl(var(--color-primary) / <alpha-value>)",
        signal: {
          green: "hsl(var(--signal-green) / <alpha-value>)",
          "green-bg": "hsl(var(--signal-green-bg) / <alpha-value>)",
          amber: "hsl(var(--signal-amber) / <alpha-value>)",
          "amber-bg": "hsl(var(--signal-amber-bg) / <alpha-value>)",
          red: "hsl(var(--signal-red) / <alpha-value>)",
          "red-bg": "hsl(var(--signal-red-bg) / <alpha-value>)",
          na: "hsl(var(--signal-na) / <alpha-value>)",
          "na-bg": "hsl(var(--signal-na-bg) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: "var(--font-sans)",
      },
      borderRadius: {
        card: "var(--radius-card)",
      },
    },
  },
  plugins: [],
};

export default config;
