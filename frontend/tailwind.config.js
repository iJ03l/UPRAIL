/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Semantic tokens driven by CSS variables in globals.css. Prefer these
        // in new code — they flip automatically with the `.dark` class.
        surface: {
          DEFAULT: 'var(--bg)',
          subtle: 'var(--bg-subtle)',
          muted: 'var(--bg-muted)',
          inset: 'var(--bg-inset)',
        },
        ink: 'var(--fg)',
        muted: 'var(--fg-muted)',
        subtle: 'var(--fg-subtle)',
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          fg: 'var(--accent-fg)',
        },
        // Hero Burnt Orange Palette
        burnt: {
          50: '#FFF6F2',
          100: '#FFE9E0',
          200: '#FFD1C2',
          300: '#FFAF94',
          400: '#FF7D54',
          500: '#E05326', // Hero Primary Burnt Orange
          600: '#C8461C',
          700: '#A43412',
          800: '#7E2910',
          900: '#521A0A',
          950: '#2A0C04',
        },
        flame: {
          300: '#FFAB76',
          400: '#FF8A50',
          500: '#FF5722',
          600: '#E64A19',
        },
        // Deep obsidian with warm terracotta warmth
        dark: {
          bg: '#0A0807',
          surface: '#120E0C',
          card: '#181310',
          cardHover: '#221B17',
          border: '#2C221D',
          borderMuted: '#1E1713',
          borderActive: '#E05326',
        },
        brand: {
          50: '#FFF6F2',
          100: '#FFE9E0',
          200: '#FFD1C2',
          300: '#FFAF94',
          400: '#FF7D54',
          500: '#E05326',
          600: '#C8461C',
          700: '#A43412',
          800: '#7E2910',
          900: '#521A0A',
          950: '#2A0C04',
        },
        near: {
          green: '#00EC97',
          cyan: '#00C1DE',
          dark: '#111827',
        }
      },
      fontFamily: {
        // Rare bespoke display font: Clash Display / Syne
        display: [
          '"Clash Display"',
          'Syne',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif',
        ],
        // Editorial grotesque: Cabinet Grotesk / Space Grotesk
        sans: [
          '"Cabinet Grotesk"',
          '"Space Grotesk"',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          'monospace',
        ],
      },
      boxShadow: {
        'glow-burnt': '0 0 35px -5px rgba(224, 83, 38, 0.45)',
        'glow-flame': '0 0 60px 0px rgba(255, 107, 53, 0.35)',
        'glow-white': '0 0 30px -5px rgba(255, 255, 255, 0.3)',
        'glow-subtle': '0 8px 32px 0 rgba(0, 0, 0, 0.7)',
        'inner-burnt': 'inset 0 0 20px 0 rgba(224, 83, 38, 0.2)',
      },
      animation: {
        'pulse-slow': 'pulse 3.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'rail-flow': 'railFlow 20s linear infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'float-slow': 'floatSlow 6s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        railFlow: {
          '0%': { backgroundPosition: '0% 0%' },
          '100%': { backgroundPosition: '200% 200%' },
        },
        floatSlow: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
    },
  },
  plugins: [],
};
