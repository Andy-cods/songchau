import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Brand = INDIGO (#4f46e5 @ 600) to match the admin app exactly
        // (Thang 2026-06-23 — app brand is indigo NOT violet; the prior violet
        // #7c3aed was the same mistake flagged in memory reference_brand_color).
        // `brand` key + 50–900 structure preserved so every brand-* class keeps
        // resolving — only the hue changes (zero JSX edits required).
        brand: {
          50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc',
          400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca',
          800: '#3730a3', 900: '#312e81',
        },
      },
      fontFamily: {
        // Vietnamese-diacritic-friendly stack mirroring the ERP frontend.
        // Pair with a next/font load in layout.tsx; absent that, this still
        // gives a sensible Inter → Be Vietnam Pro fallback for body/UI and
        // JetBrains Mono for the heavy font-mono code/date/money usage.
        sans: ['Inter', 'Be Vietnam Pro', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
