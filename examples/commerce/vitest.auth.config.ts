import { defineConfig } from 'vite-plus';

import { commerceRegistryFacts, exampleKovoCompilerPlugin } from '../vite-kovo-compiler.js';

export default defineConfig({
  plugins: [
    exampleKovoCompilerPlugin({
      include: ['src/auth.ts', 'src/domain.ts', 'src/queries.ts'],
      registryFacts: commerceRegistryFacts,
    }),
  ],
  test: {
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
