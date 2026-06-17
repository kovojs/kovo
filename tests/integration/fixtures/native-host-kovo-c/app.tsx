import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

import { LineItemsTable } from './line-items-table';

const homeRoute = route('/', {
  page: () => `<main>
    <h1>Native host identity</h1>
    ${LineItemsTable.definition.render()}
  </main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
