/** @jsxImportSource @kovojs/server */
import { createApp, publicAccess, route } from '@kovojs/server';

import { benchmarkQuery, CounterIsland } from './components/counter-island.js';

export default createApp({
  queries: [benchmarkQuery],
  routes: [
    route('/', {
      access: publicAccess('DevEx packed reference app'),
      page: () => (
        <main>
          <h1>Kovo packed reference app</h1>
          <CounterIsland />
        </main>
      ),
    }),
  ],
});
