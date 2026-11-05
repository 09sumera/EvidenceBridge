/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#FDFBF7',
          100: '#FAF8F5', // Adjudo canvas
          200: '#F4EFE6', // Soft beige surface
          300: '#EAE2D3', // Muted warm grey/border
          400: '#D5C7B0',
          500: '#BDB09B',
        },
        adjudo: {
          orange: '#FF5500',
          'orange-hover': '#EA4E00',
          'orange-light': '#FFF0E8',
          black: '#111111',
          charcoal: '#18181B',
          dark: '#0E1015',
          'dark-surface': '#181B20',
          'dark-border': '#2A2E37',
        },
        brand: {
          50:  '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        navy: {
          50:  '#f4f7fb',
          100: '#e6edf5',
          200: '#c8d7e8',
          700: '#1b3a5c',
          800: '#102a45',
          900: '#0a1d30',
          950: '#061320',
        },
        clinical: {
          50:  '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
        },
      },
      boxShadow: {
        'adjudo': '2px 2px 0px 0px #111111',
        'adjudo-sm': '1px 1px 0px 0px #111111',
        'adjudo-lg': '4px 4px 0px 0px #111111',
        'adjudo-orange': '2px 2px 0px 0px #FF5500',
        'subtle': '0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 0 0 1px rgba(15, 23, 42, 0.04)',
        'card': '0 1px 3px 0 rgba(15, 23, 42, 0.05), 0 1px 2px -1px rgba(15, 23, 42, 0.04), 0 0 0 1px rgba(15, 23, 42, 0.04)',
        'elevated': '0 4px 6px -1px rgba(15, 23, 42, 0.05), 0 2px 4px -2px rgba(15, 23, 42, 0.03), 0 0 0 1px rgba(15, 23, 42, 0.04)',
        'panel': '0 10px 25px -5px rgba(15, 23, 42, 0.06), 0 8px 10px -6px rgba(15, 23, 42, 0.03), 0 0 0 1px rgba(15, 23, 42, 0.04)',
      },
    },
  },
  plugins: [],
}
