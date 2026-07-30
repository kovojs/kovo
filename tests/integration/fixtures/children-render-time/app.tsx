/** @jsxImportSource @kovojs/server */
import { createApp } from '@kovojs/test/internal/integration/fixture-abi';
import { route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { CompositionShell } from './composition-shell';

const homeRoute = route('/', {
  page: () => (
    <main>
      <CompositionShell />
    </main>
  ),
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
