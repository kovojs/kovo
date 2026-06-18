import { createApp, endpoint, route } from '@kovojs/server';
import { renderDeferredDocument } from '@kovojs/server/internal/html';
import { defineFixture } from '@kovojs/test/internal/integration/define';
import {
  kovoFixtureStylesheetManifest,
  kovoFixtureStylesheetsForTargets,
} from 'virtual:kovo-fixture-css-manifest';

import { DeferredReview } from './deferred-review';

const reviewAsset = kovoFixtureStylesheetManifest().find(
  (asset) => asset.componentName === 'deferred-review',
);
const reviewStylesheets =
  reviewAsset && reviewAsset.fragmentTargets.length > 0
    ? kovoFixtureStylesheetsForTargets(reviewAsset.fragmentTargets)
    : reviewAsset
      ? [reviewAsset]
      : [];

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
              html: DeferredReview.definition.render() as string,
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
