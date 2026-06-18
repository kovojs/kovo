// I0 fixture: the smallest possible Kovo app — one static route. Proves the boot →
// serve → dispatch path end to end without depending on the compiler. A fixture is
// a single file: `export default defineFixture(...)`.
import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const app = createApp({
  document: { lang: 'en-US' },
  renderRoute: (value) => String(value),
  routes: [
    route('/', {
      meta: { title: 'Static Home' },
      page: () =>
        '<main data-testid="home"><h1>Hello Kovo</h1><p data-bind="greeting">Welcome</p></main>',
    }),
  ],
});

export default defineFixture({ app });
