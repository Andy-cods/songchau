import type { Config } from 'tailwindcss'

export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        brand: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
          950: '#451a03',
        },
        primary: {
          DEFAULT: '#d97706',
          foreground: '#fafaf9',
        },
        secondary: {
          DEFAULT: '#a8a29e',
          foreground: '#fafaf9',
        },
        accent: {
          DEFAULT: '#f59e0b',
          foreground: '#fafaf9',
        },
        success: '#65a30d',
        danger: '#dc2626',
        muted: {
          DEFAULT: '#1c1917',
          foreground: '#a8a29e',
        },
        card: {
          DEFAULT: '#1c1917',
          foreground: '#fafaf9',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        // Pipeline stage colors - muted minimalist
        pipeline: {
          lead: '#a8a29e',
          qualified: '#d97706',
          proposal: '#ca8a04',
          negotiation: '#b45309',
          won: '#65a30d',
          lost: '#dc2626',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config
