import { createApp, endpoint, type ResponseHeaders } from '@kovojs/server';
import { renderDeferredDocument } from '@kovojs/server/internal/html';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const deferredHome = endpoint('/', {
  csrf: false,
  csrfJustification: 'read-only deferred stream fixture',
  method: 'GET',
  reason: 'read-only deferred initial stream fixture',
  response: { appOwnedSafety: false, body: 'stream', cache: 'no-store' },
  handler: () => {
    const response = renderDeferredDocument({
      body: `<main>
        <h1>Deferred initial stream</h1>
        <kovo-defer target="reviews:p1" state="pending">
          <section aria-busy="true" data-testid="reviews-fallback">Loading reviews</section>
        </kovo-defer>
      </main>`,
      chunks: [
        {
          fragments: [
            {
              html: `<section kovo-c="reviews:p1" kovo-deps="reviews:p1">
                <h2>Reviews ready</h2>
                <p data-bind="reviews.count">1</p>
              </section>`,
              target: 'reviews:p1',
            },
          ],
          queries: [{ key: 'reviews:p1', name: 'reviews', value: { count: 1 } }],
        },
      ],
    });
    const boundary = '\n--kovo-boundary\n';
    const boundaryIndex = response.body.indexOf(boundary);
    if (boundaryIndex < 0) throw new Error('Expected deferred stream boundary');
    const shell = response.body.slice(0, boundaryIndex);
    const late = response.body.slice(boundaryIndex);

    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(shell));
          setTimeout(() => {
            controller.enqueue(new TextEncoder().encode(late));
            controller.close();
          }, 250);
        },
      }),
      {
        headers: webResponseHeaders(response.headers),
        status: response.status,
      },
    );
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
  webHeaders.set('cache-control', 'no-store');

  return webHeaders;
}

export default defineFixture({
  app: createApp({ endpoints: [deferredHome] }),
});
