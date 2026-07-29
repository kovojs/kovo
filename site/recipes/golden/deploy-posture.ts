import { defineConfig, node } from '@kovojs/server/build';

export const deployPosture = defineConfig({
  preset: node({
    retention: {
      hours: 24,
      immutableClientModules: 'retained',
      priorTokenQueryReads: 'retained',
    },
  }),
});
