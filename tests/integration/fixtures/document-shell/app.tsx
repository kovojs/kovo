import { createApp, renderQueryScript, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

const shellQuery = { message: 'Shell ready' };

const homeRoute = route('/', {
  meta: { title: 'Document Shell' },
  page: () => `${renderQueryScript({ name: 'shell', value: shellQuery })}
    <main>
      <h1>Document Shell</h1>
      <section kovo-deps="shell">
        <output data-bind="shell.message">${shellQuery.message}</output>
      </section>
    </main>`,
});

export default defineFixture({
  app: createApp({
    document: { lang: 'en-US' },
    routes: [homeRoute],
  }),
});
