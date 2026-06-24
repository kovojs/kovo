import { createApp, publicAccess, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { AppLayout, HomePage, ReportsPage } from './layout';

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: () => AppLayout({ section: 'home', children: HomePage() }),
});

const reportsRoute = route('/reports', {
  access: publicAccess('integration fixture route /reports has no runtime guard'),
  page: () => AppLayout({ section: 'reports', children: ReportsPage() }),
});

export default defineFixture({
  app: createApp({ routes: [homeRoute, reportsRoute] }),
});
