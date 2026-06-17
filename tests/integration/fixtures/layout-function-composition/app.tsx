import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { AppLayout, HomePage, ReportsPage } from './layout';

const homeRoute = route('/', {
  page: () => AppLayout({ section: 'home', children: HomePage() }),
});

const reportsRoute = route('/reports', {
  page: () => AppLayout({ section: 'reports', children: ReportsPage() }),
});

export default defineFixture({
  app: createApp({ routes: [homeRoute, reportsRoute] }),
});
