import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "rgba(255,255,255,0.12)",
        background: "#121318",
        foreground: "#e3e1e9",
        muted: "rgba(52,52,58,0.25)",
        "muted-foreground": "#d0c6ab",
        card: "rgba(52,52,58,0.18)",
        primary: "#ffd700",
        secondary: "#00e3fd",
        destructive: "#ffb4ab",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "sans-serif"],
        display: ["ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
