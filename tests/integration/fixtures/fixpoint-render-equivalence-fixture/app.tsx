/** @jsxImportSource @kovojs/server */
import { createApp } from '@kovojs/test/internal/integration/fixture-abi';
import { route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { FixpointRenderEquivalenceCard } from './fixpoint-card';

const homeRoute = route('/', {
  meta: { title: 'Fixpoint render equivalence fixture' },
  page: () => (
    <main>
      <FixpointRenderEquivalenceCard />
    </main>
  ),
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
