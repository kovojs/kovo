import { kovo } from '@kovojs/server/vite';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        styles: '../shared/styles.css',
      },
    },
  },
  plugins: [kovo({ app: '/src/app.tsx' })],
});
