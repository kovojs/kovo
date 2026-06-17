import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { CompositionShell } from './composition-shell';

const homeRoute = route('/', {
  page: () => `<main>${CompositionShell.definition.render()}</main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
