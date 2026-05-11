import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Migrant Workers Office Singapore brand palette (Philippine flag)
        brand: {
          burgundy: '#b02f47',
          navy: '#2a4090',
          yellow: '#f4dd4c',
          ink: '#1a1a1a',
          paper: '#fafaf7', // warm off-white surface
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      letterSpacing: {
        kicker: '0.32em',
      },
    },
  },
  plugins: [],
};

export default config;
