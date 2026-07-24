import { defineConfig, node } from '@kovojs/server/build';

export default defineConfig({
  preset: node({
    retention: {
      hours: 24,
      immutableClientModules: 'retained',
      priorTokenQueryReads: 'retained',
    },
  }),
});
