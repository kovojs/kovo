import { createApp, publicAccess, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { LineItemsTable } from './line-items-table';

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: () => `<main>
    <h1>Native host identity</h1>
    ${LineItemsTable.definition.render()}
  </main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
