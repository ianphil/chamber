import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  css: {
    postcss: {
      plugins: [
        require('@tailwindcss/postcss'),
      ],
    },
  },
});
