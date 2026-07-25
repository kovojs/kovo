/** @jsxImportSource @kovojs/server */
import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { PrimitiveStateAttrsCard } from './state-card';

const homeRoute = route('/', {
  meta: { title: 'Primitive state attrs' },
  page: () => (
    <main>
      <h1>Primitive state attrs</h1>
      <PrimitiveStateAttrsCard />
    </main>
  ),
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
