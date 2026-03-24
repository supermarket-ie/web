import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          green: "#1B4D3E",
          "green-light": "#2D6B57",
          coral: "#FF6B5B",
          "coral-dark": "#E85A4A",
        },
        surface: {
          DEFAULT: "#FAFAFA",
          card: "#FFFFFF",
        },
        ink: {
          DEFAULT: "#1A1A1A",
          muted: "#6B7280",
          faint: "#D1D5DB",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
