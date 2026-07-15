import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./src/runtime-lock.test-setup.ts'],
  },
});
