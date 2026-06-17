import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { PrimitiveAsChildCard } from './card';

const homeRoute = route('/', {
  page: () => `<main>${PrimitiveAsChildCard.definition.render() as string}</main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
