/** @jsxImportSource @kovojs/server */
import { createApp } from '@kovojs/test/internal/integration/fixture-abi';
import { route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { PrimitiveIdAuthorWinsCard } from './dialog-card';

const homeRoute = route('/', {
  page: () => (
    <main>
      <PrimitiveIdAuthorWinsCard />
    </main>
  ),
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
