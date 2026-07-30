/** @jsxImportSource @kovojs/server */
import { benchmarkQuery, CounterIsland } from './components/counter-island.js';
import { app } from './kovo.js';

const home = app.route('/', {
  access: app.publicAccess('DevEx packed reference app'),
  page: () => (
    <main>
      <h1>Kovo packed reference app</h1>
      <CounterIsland />
    </main>
  ),
});

export default app.assemble({
  queries: [benchmarkQuery],
  routes: [home],
});
