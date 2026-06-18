// Mutation wire fixture for SPEC.md §9.1 and §9.2: without Kovo-Fragment, the
// mutation endpoint uses POST-redirect-GET on success and full-page errors.
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export const subscribe = mutation('newsletter/subscribe', {
  csrf: false,
  errors: { ALREADY_SUBSCRIBED: s.object({ email: s.string() }) },
  input: s.object({
    email: s.string(),
    seats: s.number().int().min(1),
  }),
  handler: async (input, request: KovoFixtureRequest, context) => {
    if (input.email === 'taken@example.com') {
      return context.fail('ALREADY_SUBSCRIBED', { email: input.email });
    }
    await request.db.query('insert into subscribers (email, seats) values ($1, $2)', [
      input.email,
      input.seats,
    ]);
    return { email: input.email };
  },
});

const homeRoute = route('/', {
  page: () => `<main>
    <h1>Newsletter</h1>
    <form method="post" action="/_m/newsletter/subscribe" data-mutation="newsletter/subscribe">
      <label>Email <input name="email" type="email" value="ada@example.com" /></label>
      <label>Seats <input name="seats" type="number" value="1" /></label>
      <button type="submit">Subscribe</button>
    </form>
  </main>`,
});

const thanksRoute = route('/thanks', {
  page: () => '<main><h1>Subscribed</h1></main>',
});

function renderAlreadySubscribedPage(code: string): string {
  return `<!doctype html><html><body><main><output role="alert" data-error-code="${code}">Already subscribed</output></main></body></html>`;
}

const app = createApp({
  mutations: [subscribe],
  routes: [homeRoute, thanksRoute],
  mutationResponses: {
    [subscribe.key]: () => {
      return {
        redirectTo: '/thanks',
        renderFailurePage: (failure) => renderAlreadySubscribedPage(failure.error.code),
      };
    },
  },
});

export default defineFixture({
  app,
  schema:
    'create table subscribers (id serial primary key, email text not null, seats integer not null check (seats > 0))',
});
