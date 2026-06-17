// SPEC §13.1: late mutation fragments may request stylesheet assets needed only by
// fragment-rendered static CSS classes.
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

export const revealRecommendation = mutation('late-fragment-static-css/reveal', {
  csrf: false,
  input: s.object({}),
  handler: () => ({ ok: true }),
});

const homeRoute = route('/', {
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
    mutationResponse: ({ key }) => {
      if (key !== revealRecommendation.key) return undefined;
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
  }),
});
