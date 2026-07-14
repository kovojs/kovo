/** @jsxImportSource @kovojs/server */
// Mutation wire fixture for SPEC.md §9.1 and §9.2: without Kovo-Fragment, the
// mutation endpoint uses POST-redirect-GET on success and full-page errors.
import { FormError } from '@kovojs/core';
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export const subscribe = mutation('newsletter/subscribe', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/thanks',
  errors: { ALREADY_SUBSCRIBED: s.object({ email: s.string() }) },
  input: s.object({
    email: s.string(),
    seats: s.number().int().min(1),
  }),
  registry: { tables: ['subscribers'] },
  handler: async (input, request: KovoFixtureRequest, context) => {
    if (input.email === 'taken@example.com') {
      return context.fail('ALREADY_SUBSCRIBED', { email: input.email });
    }
    await request.db.query({
      text: 'insert into subscribers (email, seats) values ($1, $2)',
      values: [input.email, input.seats],
    });
    return { email: input.email };
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <h1>Newsletter</h1>
      <form mutation={subscribe}>
        <label>
          Email <input name="email" type="email" value="ada@example.com" />
        </label>
        <label>
          Seats <input name="seats" type="number" value="1" />
        </label>
        <FormError code="ALREADY_SUBSCRIBED" message="Already subscribed" />
        <button type="submit">Subscribe</button>
      </form>
    </main>
  ),
});

const thanksRoute = route('/thanks', {
  page: () => '<main><h1>Subscribed</h1></main>',
});

const app = createApp({
  mutations: [subscribe],
  routes: [homeRoute, thanksRoute],
});

export default defineFixture({
  app,
  schema:
    'create table subscribers (id serial primary key, email text not null, seats integer not null check (seats > 0))',
});
