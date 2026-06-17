import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const homeRoute = route('/', {
  meta: { title: 'Custom Document Template' },
  page: () => `<main>
    <h1>Custom Document Template</h1>
    <button type="button" on:click="/client.ts#mark">Run client handler</button>
    <output data-template-result>idle</output>
  </main>`,
});

export default defineFixture({
  app: createApp({
    document: {
      lang: 'en-GB',
      template: ({ parts }) =>
        [
          '<!doctype html>',
          `<html lang="${parts.lang}" data-template="custom">`,
          '<head>',
          '<meta charset="utf-8">',
          '<meta name="kovo-template" content="custom">',
          parts.head,
          parts.queryScripts.join(''),
          '</head>',
          '<body>',
          '<header role="banner">Custom Chrome</header>',
          `<div data-shell-frame>${parts.body}</div>`,
          '</body>',
          '</html>',
        ].join(''),
    },
    routes: [homeRoute],
  }),
});
