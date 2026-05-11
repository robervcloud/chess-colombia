/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta inspirada en madera de tablero + acento esmeralda
        ink:    '#1a1612',
        parch:  '#f5efe6',
        wood: {
          50:  '#f8f1e3',
          100: '#ecdfc1',
          200: '#d8c094',
          400: '#a87c4f',
          600: '#6e4a26',
          800: '#3a2716',
        },
        accent: {
          DEFAULT: '#1f7a5a', // verde esmeralda profundo
          light:   '#2da97f',
          dark:    '#0f4f3a',
        },
        // Acento cálido (dorado tabaco) para detalles premium
        gold: {
          DEFAULT: '#c9a24a',
          light:   '#e8c873',
          dark:    '#9a7732',
        },
        // Rojo cálido (terracota) para low-time y estados de presión
        clay: {
          DEFAULT: '#c25a3a',
          light:   '#d97a5a',
          dark:    '#8e3f26',
        },
        danger: '#b3392c',
      },
      fontFamily: {
        display: ['var(--font-display)', 'serif'],
        sans:    ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 0 rgba(0,0,0,0.04), 0 8px 24px -12px rgba(0,0,0,0.18)',
        glow: '0 0 0 1px rgba(201,162,74,0.35), 0 8px 24px -10px rgba(201,162,74,0.35)',
      },
      keyframes: {
        clockPulse: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.55' },
        },
        breath: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%':      { transform: 'scale(1.015)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'clock-pulse': 'clockPulse 1.1s ease-in-out infinite',
        'breath':      'breath 3.5s ease-in-out infinite',
        'shimmer':     'shimmer 2s linear infinite',
      },
    },
  },
  plugins: [],
};
