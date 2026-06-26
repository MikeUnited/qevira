import type { Config } from "tailwindcss";

/** BAMYS design tokens — also mirrored in `app/globals.css` @theme for Tailwind v4. */
export default {
  theme: {
    extend: {
      colors: {
        brand: "#4f46e5",
        surface: "#f9fafb",
        "border-ui": "#e5e7eb",
        "border-in": "#d1d5dc",
        "txt-1": "#0a0a0a",
        "txt-2": "#4a5565",
        "txt-3": "#6a7282",
        warn: "#e17100",
        "warn-bg": "#fffbeb",
        "warn-br": "#fee685",
      },
      fontFamily: {
        mono: ["Menlo", "Monaco", "Courier New", "monospace"],
      },
      borderRadius: {
        card: "10px",
      },
    },
  },
} satisfies Config;
