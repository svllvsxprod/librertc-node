import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(214 20% 22%)",
        background: "hsl(220 20% 8%)",
        foreground: "hsl(210 22% 94%)",
        muted: "hsl(218 16% 16%)",
        "muted-foreground": "hsl(215 13% 66%)",
        card: "hsl(220 18% 11%)",
        primary: "hsl(172 72% 44%)",
        destructive: "hsl(4 82% 62%)",
      },
    },
  },
  plugins: [],
} satisfies Config;
