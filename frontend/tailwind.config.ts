import type { Config } from 'tailwindcss';

const config: Config = {
  // 'class' strategy → toggle dark mode by adding `class="dark"` to <html>.
  // Driven by ThemeProvider (src/providers/theme-provider.tsx).
  darkMode: 'class',
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f4ff',
          100: '#e0e9ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#1e1b4b',
          950: '#15123a',
        },
        status: {
          success: '#059669',
          'success-bg': '#f0fdf4',
          warning: '#d97706',
          'warning-bg': '#fffbeb',
          danger: '#dc2626',
          'danger-bg': '#fef2f2',
          info: '#0891b2',
          'info-bg': '#ecfeff',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Be Vietnam Pro', 'Segoe UI', 'system-ui', 'sans-serif'],
        display: ['Syne', 'Be Vietnam Pro', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
