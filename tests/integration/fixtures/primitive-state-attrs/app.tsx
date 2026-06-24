import { createApp, publicAccess, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { PrimitiveStateAttrsCard } from './state-card';

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  meta: { title: 'Primitive state attrs' },
  page: () =>
    `<main><h1>Primitive state attrs</h1>${PrimitiveStateAttrsCard.definition.render() as string}</main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
