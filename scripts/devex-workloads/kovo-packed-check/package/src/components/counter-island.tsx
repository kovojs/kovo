/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { s } from '@kovojs/server';

import { app } from '../kovo.js';

export const benchmarkRevision = 0;
export const benchmarkQuery = app.query({
  access: app.publicAccess('DevEx packed reference query'),
  load: () => ({ label: 'ready' }),
  output: s.object({ label: s.string() }),
});

export const CounterIsland = component({
  queries: { benchmark: benchmarkQuery },
  state: () => ({ count: 0 }),
  render: ({ benchmark }, state) => (
    <button
      aria-label="increment benchmark counter"
      data-revision="zero"
      type="button"
      onClick={() => {
        state.count += 1;
      }}
    >
      {benchmark.label}: {state.count}
    </button>
  ),
});
