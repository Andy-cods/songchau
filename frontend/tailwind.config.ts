import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f4ff',
          100: '#e0e9ff',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          900: '#1e1b4b',
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
