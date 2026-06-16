import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';
import { kovoFixtureStylesheetsForTargets } from 'virtual:kovo-fixture-css-manifest';

import { ScopedPanel } from './scoped-panel';

const homeRoute = route('/', {
  stylesheets: kovoFixtureStylesheetsForTargets(),
  page: () => `<main>${ScopedPanel.definition.render({}, null) as string}</main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
