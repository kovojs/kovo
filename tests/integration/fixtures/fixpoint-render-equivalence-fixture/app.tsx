import { createApp, publicAccess, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { FixpointRenderEquivalenceCard, type FixpointState } from './fixpoint-card';

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  meta: { title: 'Fixpoint render equivalence fixture' },
  page: () => {
    const definition = FixpointRenderEquivalenceCard.definition as unknown as {
      render: (queries: Record<string, never>, state: FixpointState) => unknown;
      state?: () => FixpointState;
    };
    const initialState = definition.state?.() ?? { count: 0, open: false };
    return `<main>${definition.render({}, initialState) as string}</main>`;
  },
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
