import { createApp, endpoint, renderDeferredDocument, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';
import {
  kovoFixtureStylesheetManifest,
  kovoFixtureStylesheetsForTargets,
} from 'virtual:kovo-fixture-css-manifest';

import { DeferredReview } from './deferred-review';

const reviewTarget =
  kovoFixtureStylesheetManifest().find((asset) => asset.componentName === 'deferred-review')
    ?.fragmentTargets[0] ?? 'deferred-review/deferred-review';
const reviewStylesheets = kovoFixtureStylesheetsForTargets([reviewTarget]);

const homeRoute = route('/', {
  page: () => `<main>
    <h1>Deferred fragment styles</h1>
    <section kovo-fragment-target="deferred-review">Loading reviews</section>
    <script type="module" src="/client.ts"></script>
  </main>`,
});

const deferredWire = endpoint('/deferred-wire', {
  csrf: false,
  csrfJustification: 'read-only fixture stream',
  method: 'GET',
  handler: () => {
    const response = renderDeferredDocument({
      body: '<section kovo-fragment-target="deferred-review">Loading reviews</section>',
      chunks: [
        {
          fragments: [
            {
              html: DeferredReview.definition.render({}, null) as string,
              mode: 'append',
              stylesheets: reviewStylesheets,
              target: 'deferred-review',
            },
          ],
        },
      ],
    });

    return new Response(response.body, {
      headers: response.headers,
      status: response.status,
    });
  },
});

export default defineFixture({
  app: createApp({ endpoints: [deferredWire], routes: [homeRoute] }),
});
