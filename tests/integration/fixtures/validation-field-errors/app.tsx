/** @jsxImportSource @kovojs/server */
// Mutation wire fixture for SPEC.md §6.3 and §9.2: schema validation failures
// return HTTP 422 with field-scoped error anchors and leave server truth alone.
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { ReservationForm } from './reservation-form';

export const reserve = mutation('validation/reserve', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({
    quantity: s.number().int().min(1),
  }),
  handler: async (input, request: KovoFixtureRequest) => {
    await request.db.query({
      text: 'insert into reservations (quantity) values ($1)',
      values: [input.quantity],
    });
    return { quantity: input.quantity };
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <h1>Reserve inventory</h1>
      <ReservationForm />
    </main>
  ),
});

const app = createApp({
  mutations: [reserve],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema:
    'create table reservations (id serial primary key, quantity integer not null check (quantity > 0))',
});
