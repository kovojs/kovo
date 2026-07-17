import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { MetaRefreshProbe, metaRefreshPage } from './meta-refresh';

const probeRoute = route('/meta-refresh', {
  page: (_context, request: Request) => {
    const page = metaRefreshPage(new URL(request.url));
    return `${MetaRefreshProbe.definition.render({ page })}
      <main><h1>Meta refresh sink app</h1></main>`;
  },
});

export default defineFixture({
  app: createApp({ routes: [probeRoute] }),
});
