import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "#080b0f",
        panel: "#10151c",
        panel2: "#151b23",
        border: "#25303b",
        muted: "#8b98a8",
        positive: "#31c48d",
        negative: "#f05252",
        warning: "#f59e0b",
        source: "#60a5fa"
      },
      borderRadius: {
        card: "8px"
      }
    }
  },
  plugins: []
};

export default config;
