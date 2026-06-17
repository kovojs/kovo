import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

import { PrimitiveStateAttrsCard } from './state-card';

const homeRoute = route('/', {
  meta: { title: 'Primitive state attrs' },
  page: () =>
    `<main><h1>Primitive state attrs</h1>${PrimitiveStateAttrsCard.definition.render({}, null) as string}</main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
