import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

import { FixpointRenderEquivalenceCard } from './fixpoint-card';

const homeRoute = route('/', {
  meta: { title: 'Fixpoint render equivalence fixture' },
  page: () => {
    const initialState = FixpointRenderEquivalenceCard.definition.state?.() ?? {};
    return `<main>${FixpointRenderEquivalenceCard.definition.render({}, initialState) as string}</main>`;
  },
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
