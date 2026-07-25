/** @jsxImportSource @kovojs/server */
import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';
import { kovoFixtureStylesheetsForTargets } from 'virtual:kovo-fixture-css-manifest';

import { ScopedPanel } from './scoped-panel';

const homeRoute = route('/', {
  stylesheets: kovoFixtureStylesheetsForTargets(),
  page: () => (
    <main>
      <ScopedPanel />
    </main>
  ),
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
