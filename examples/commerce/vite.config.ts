import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        tailwind: 'src/styles.css',
      },
      output: {
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  plugins: [tailwindcss()],
});
