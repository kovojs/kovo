// SPEC §13.1: late mutation fragments may request stylesheet assets needed only by
// fragment-rendered static CSS classes.
import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

export const revealRecommendation = mutation('late-fragment-static-css/reveal', {
  access: publicAccess('integration fixture mutation late-fragment-static-css/reveal has no runtime guard'),
  csrf: false,
  input: s.object({}),
  handler: () => ({ ok: true }),
});

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: () => `<main>
    <h1>Fragment CSS</h1>
    <section kovo-fragment-target="recommendations" kovo-deps="recommendations"></section>
    <form method="post" action="/_m/late-fragment-static-css/reveal" enhance data-mutation="late-fragment-static-css/reveal">
      <button type="submit">Show recommendation</button>
    </form>
  </main>`,
});

export default defineFixture({
  app: createApp({
    mutations: [revealRecommendation],
    routes: [homeRoute],
    mutationResponses: {
      [revealRecommendation.key]: () => {
        return {
          fragmentRenderers: [
            {
              mode: 'append',
              render: () =>
                '<article class="recommendation-card" data-recommendation>Styled recommendation</article>',
              stylesheets: ['/assets/fragment.css', '/assets/fragment.css'],
              target: 'recommendations',
            },
          ],
        };
      },
    },
  }),
});
