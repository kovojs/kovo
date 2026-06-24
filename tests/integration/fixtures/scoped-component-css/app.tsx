import { createApp, publicAccess, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';
import { kovoFixtureStylesheetsForTargets } from 'virtual:kovo-fixture-css-manifest';

import { ScopedPanel } from './scoped-panel';

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  stylesheets: kovoFixtureStylesheetsForTargets(),
  page: () => `<main>${ScopedPanel.definition.render() as string}</main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
