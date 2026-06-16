import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

import { PrimitiveIdAuthorWinsCard } from './dialog-card';

const homeRoute = route('/', {
  page: () => `<main>${PrimitiveIdAuthorWinsCard.definition.render({}, null) as string}</main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
