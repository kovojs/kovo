import { restoreBootstrapPoison } from './poison.js';
import { assertCompilerSecurityIntrinsics } from '@kovojs/compiler/internal';
import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

try {
  assertCompilerSecurityIntrinsics();
} finally {
  restoreBootstrapPoison();
}

export default defineFixture({
  app: createApp({
    routes: [
      route('/', {
        page: () => '<main><h1>Bootstrap first</h1></main>',
      }),
    ],
  }),
});
