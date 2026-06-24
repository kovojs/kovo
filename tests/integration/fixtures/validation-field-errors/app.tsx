// Mutation wire fixture for SPEC.md §6.3 and §9.2: schema validation failures
// return HTTP 422 with field-scoped error anchors and leave server truth alone.
import {
  createApp,
  mutation,
  route,
  s,
  type MutationFail,
  type ValidationFailurePayload,

  publicAccess,} from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export const reserve = mutation('validation/reserve', {
  access: publicAccess('integration fixture mutation validation/reserve has no runtime guard'),
  csrf: false,
  input: s.object({
    quantity: s.number().int().min(1),
  }),
  handler: async (input, request: KovoFixtureRequest) => {
    await request.db.query('insert into reservations (quantity) values ($1)', [input.quantity]);
    return { quantity: input.quantity };
  },
});

function renderReservationForm(failure?: MutationFail): string {
  const payload =
    failure?.error.code === 'VALIDATION'
      ? (failure.error.payload as ValidationFailurePayload)
      : undefined;
  const issue = payload?.issues[0];
  const error =
    issue === undefined
      ? ''
      : `<output role="alert" data-error-path="${issue.path.join('.')}">${issue.message}</output>`;

  return `<form method="post" action="/_m/validation/reserve" enhance
      data-mutation="validation/reserve" kovo-fragment-target="reservation-form">
      <label>Quantity <input name="quantity" type="number" value="0" /></label>
      ${error}
      <button type="submit">Reserve</button>
    </form>`;
}

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: () => `<main>
    <h1>Reserve inventory</h1>
    ${renderReservationForm()}
  </main>`,
});

const app = createApp({
  mutations: [reserve],
  routes: [homeRoute],
  mutationResponses: {
    [reserve.key]: () => {
      return {
        failureTarget: 'reservation-form',
        redirectTo: '/',
        renderFailureFragment: renderReservationForm,
      };
    },
  },
});

export default defineFixture({
  app,
  schema:
    'create table reservations (id serial primary key, quantity integer not null check (quantity > 0))',
});
