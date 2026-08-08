import { kovo } from '@kovojs/server/vite';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        styles: 'src/styles.css',
      },
    },
  },
  plugins: [kovo({ app: '/src/app.tsx' })],
});
