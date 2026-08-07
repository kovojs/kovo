import { defineConfig, node } from '@kovojs/server/build';

// The benchmark harness serves one immutable build from a single local process for the lifetime of
// a run, so prior `/c/__v/...` modules and prior-token `/_q` reads are trivially retained
// (SPEC §14). Declaring the floor explicitly is what `kovo build --preset node` requires (KV417).
export default defineConfig({
  preset: node({
    retention: {
      hours: 24,
      immutableClientModules: 'retained',
      priorTokenQueryReads: 'retained',
    },
  }),
});
