import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const app = createApp({
  routes: [
    route('/', {
      page: () => '<main><h1>Diagnostic Warning Nonblocking</h1></main>',
    }),
  ],
});

export default defineFixture({ app });
