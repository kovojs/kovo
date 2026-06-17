import { createApp, endpoint, renderDeferredDocument } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

const deferredHome = endpoint('/', {
  csrf: false,
  csrfJustification: 'read-only deferred stream fixture',
  method: 'GET',
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
        headers: response.headers,
        status: response.status,
      },
    );
  },
});

export default defineFixture({
  app: createApp({ endpoints: [deferredHome] }),
});
