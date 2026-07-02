/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Neutral dark palette for the v1 shell. Kept as literal hex so the
      // skeleton is self-contained; later phases can promote these to CSS
      // custom properties if a light theme is added.
      colors: {
        ink: {
          950: "#0a0b0d",
          900: "#101216",
          850: "#161920",
          800: "#1c2027",
          700: "#272c35",
          600: "#333a45",
        },
        fg: {
          DEFAULT: "#e8eaee",
          muted: "#aab0ba",
          dim: "#646c78",
        },
        accent: {
          DEFAULT: "#d97757",
          hover: "#e08a6e",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
