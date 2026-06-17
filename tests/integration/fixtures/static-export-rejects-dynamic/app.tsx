import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const app = createApp({
  routes: [
    route('/', {
      page: () => '<main><h1>Static Export Dynamic Policy</h1></main>',
    }),
  ],
});

export default defineFixture({ app });
