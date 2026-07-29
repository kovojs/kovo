import { defineConfig, node } from '@kovojs/server/build';

export const deployConfig = defineConfig({
  preset: node({
    retention: {
      hours: 24,
      immutableClientModules: 'retained',
      priorTokenQueryReads: 'retained',
    },
  }),
});
