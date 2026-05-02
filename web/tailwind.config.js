/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Outfit"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        void: '#07060c',
        ember: '#ff6b35',
        arc: '#00e5c7',
        dust: '#b8a9c9',
        panel: 'rgba(18, 16, 28, 0.72)',
      },
      backgroundImage: {
        'grid-glow':
          'linear-gradient(to right, rgba(0,229,199,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,229,199,0.07) 1px, transparent 1px)',
      },
    },
  },
  plugins: [],
};
