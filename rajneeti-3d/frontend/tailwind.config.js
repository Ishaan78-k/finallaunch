/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { ink: '#1d2340', paper: '#fff8ea', saffron: '#ff9f1c', berry: '#e0457b' },
      borderRadius: { game: '18px' },
    },
  },
  plugins: [],
};
