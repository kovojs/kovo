import { createApp, publicAccess, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { PrimitiveIdAuthorWinsCard } from './dialog-card';

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: () => `<main>${PrimitiveIdAuthorWinsCard.definition.render() as string}</main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
