import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

const app = createApp({
  routes: [
    route('/', {
      page: () => '<main><h1>Diagnostic Dev Document</h1></main>',
    }),
  ],
});

export default defineFixture({ app });
