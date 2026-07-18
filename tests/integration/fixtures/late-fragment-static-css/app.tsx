/** @jsxImportSource @kovojs/server */
// SPEC §13.1: late mutation fragments may request stylesheet assets needed only by
// fragment-rendered static CSS classes.
import { createApp, mutation, route, s, stream } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

export const revealRecommendation = mutation('late-fragment-static-css/reveal', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  input: s.object({}),
  handler: () => ({ ok: true }),
  async *stream() {
    yield stream.fragment({
      html: (
        <>
          <link rel="stylesheet" href="/assets/fragment.css" />
          <article class="recommendation-card" data-recommendation>
            Styled recommendation
          </article>
        </>
      ),
      mode: 'append',
      target: 'recommendations',
    });
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <h1>Fragment CSS</h1>
      <section kovo-fragment-target="recommendations" kovo-deps="recommendations"></section>
      <form mutation={revealRecommendation} enhance stream>
        <button type="submit">Show recommendation</button>
      </form>
    </main>
  ),
});

export default defineFixture({
  app: createApp({
    mutations: [revealRecommendation],
    routes: [homeRoute],
  }),
});
