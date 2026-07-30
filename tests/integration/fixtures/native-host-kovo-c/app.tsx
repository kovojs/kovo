/** @jsxImportSource @kovojs/server */
import { createApp } from '@kovojs/test/internal/integration/fixture-abi';
import { route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { LineItemsTable } from './line-items-table';

const homeRoute = route('/', {
  page: () => (
    <main>
      <h1>Native host identity</h1>
      <LineItemsTable />
    </main>
  ),
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
