import { createApp, endpoint, publicAccess, route, type ResponseHeaders } from '@kovojs/server';
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
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: () => `<main>
    <h1>Deferred fragment styles</h1>
    <section kovo-fragment-target="deferred-review">Loading reviews</section>
    <script type="module" src="/client.ts"></script>
  </main>`,
});

const deferredWire = endpoint('/deferred-wire', {
  access: publicAccess('integration fixture endpoint /deferred-wire has no runtime guard'),
  csrf: false,
  csrfJustification: 'read-only fixture stream',
  method: 'GET',
  reason: 'read-only deferred fragment style stream fixture',
  response: { appOwnedSafety: false, body: 'html', cache: 'no-store' },
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
      headers: webResponseHeaders(response.headers),
      status: response.status,
    });
  },
});

function webResponseHeaders(headers: ResponseHeaders): Headers {
  const webHeaders = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) webHeaders.append(name, entry);
    } else {
      webHeaders.set(name, value);
    }
  }

  return webHeaders;
}

export default defineFixture({
  app: createApp({ endpoints: [deferredWire], routes: [homeRoute] }),
});
