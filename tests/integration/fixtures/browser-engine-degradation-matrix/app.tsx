// SPEC.md §8: the cross-engine degradation contract keeps L0 documents, L1
// forms, and L2 loader enhancements usable outside Chromium.
import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
import { renderQueryScript } from '@kovojs/server/internal/html';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { EngineMatrixCard } from './engine-card';
import { engineQuery, readEngineState } from './shared';

async function renderEngineCard(db: KovoFixtureRequest['db']): Promise<string> {
  const engine = await readEngineState(db);
  return EngineMatrixCard.definition.render({ engine }) as unknown as string;
}

async function renderInitialReport(db: KovoFixtureRequest['db']): Promise<string> {
  const rows = await db.query<{ include_gift: number; quantity: number }>(
    'select quantity, include_gift from engine_matrix_submit_log order by id desc limit 1',
  );
  const row = rows[0];
  if (!row) return '<output data-submit-report>no submissions yet</output>';
  return `<output data-submit-report>
    quantity=${row.quantity}; includeGift=${row.include_gift === 1 ? 'true' : 'false'}
  </output>`;
}

function renderSubmittedReport(rawInput: FormData): string {
  const field = (name: string): string => {
    const value = rawInput.get(name);
    return typeof value === 'string' ? value : 'missing';
  };

  return `<output data-submit-report>
    intent=${field('intent')}; quantity=${field('quantity')}; includeGift=${field('includeGift')}; adminNote=${field('adminNote')}
  </output>`;
}

export const submitMatrixForm = mutation('engine-matrix/submit', {
  access: publicAccess('integration fixture mutation engine-matrix/submit has no runtime guard'),
  csrf: false,
  input: s.object({
    includeGift: s.boolean(),
    quantity: s.number().int().min(1),
  }),
  handler: async (input, request: KovoFixtureRequest) => {
    await request.db.query(
      'insert into engine_matrix_submit_log (quantity, include_gift) values ($1, $2)',
      [input.quantity, input.includeGift ? 1 : 0],
    );
    return {};
  },
});

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: async (_context, request: KovoFixtureRequest) => {
    const engine = await readEngineState(request.db);
    return `${renderQueryScript({ name: 'engine', value: engine })}
    <script type="module" src="/client.ts"></script>
    <main>
      <h1>Engine matrix</h1>
      <p data-bind="greeting">Welcome</p>
      <form id="engine-matrix-form" method="post" action="/_m/engine-matrix/submit">
        <label>Quantity <input name="quantity" type="number" value="2" min="1" /></label>
        <label><input name="includeGift" type="checkbox" value="true" checked /> Include gift wrap</label>
        <input name="adminNote" value="do-not-include" disabled />
        <button type="submit" name="intent" value="confirm">Submit matrix form</button>
      </form>
      <div kovo-fragment-target="engine-matrix-report" kovo-deps="engine">${await renderInitialReport(request.db)}</div>
      <kovo-fragment target="engine-card">${await renderEngineCard(request.db)}</kovo-fragment>
    </main>`;
  },
});

const app = createApp({
  mutations: [submitMatrixForm],
  queries: [engineQuery],
  routes: [homeRoute],
  mutationResponses: {
    [submitMatrixForm.key]: ({ rawInput }) => {
      return {
        fragmentRenderers: [
          {
            render: () => renderSubmittedReport(rawInput as FormData),
            target: 'engine-matrix-report',
          },
        ],
      };
    },
  },
});

export default defineFixture({
  app,
  schema: `
    create table engine_matrix_state (id integer primary key, message text not null);
    create table engine_matrix_submit_log (
      id integer primary key generated always as identity,
      quantity integer not null,
      include_gift integer not null
    );
  `,
  seed: (db) =>
    db.exec("insert into engine_matrix_state (id, message) values (1, 'Initial message')"),
});
