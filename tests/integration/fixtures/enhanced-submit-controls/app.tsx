// SPEC.md §6.3/§9.1: enhanced submission preserves real POST form markup, and
// schema-coerced inputs remain observable on the server after enhancement.
import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

interface SubmissionRow {
  [key: string]: unknown;
  include_gift: number;
  quantity: number;
}

async function readLatestSubmission(db: KovoFixtureRequest['db']): Promise<SubmissionRow | null> {
  const rows = await db.query<SubmissionRow>(
    'select quantity, include_gift from enhanced_submit_log order by id desc limit 1',
  );
  return rows[0] ?? null;
}

async function renderInitialReport(db: KovoFixtureRequest['db']): Promise<string> {
  const row = await readLatestSubmission(db);
  if (!row) return '<output data-submit-report>no submissions yet</output>';
  return `<output data-submit-report>
    quantity=${row.quantity}; includeGift=${row.include_gift === 1 ? 'true' : 'false'}
  </output>`;
}

function renderSubmittedReport(rawInput: FormData): string {
  return `<output data-submit-report>
    intent=${submittedValue(rawInput, 'intent')}; quantity=${submittedValue(rawInput, 'quantity')}; includeGift=${submittedValue(rawInput, 'includeGift')}; adminNote=${submittedValue(rawInput, 'adminNote')}
  </output>`;
}

function submittedValue(rawInput: FormData, name: string): string {
  const value = rawInput.get(name);
  return typeof value === 'string' ? value : 'missing';
}

export const submitOrder = mutation('enhanced-submit-controls/submit', {
  access: publicAccess('integration fixture mutation enhanced-submit-controls/submit has no runtime guard'),
  csrf: false,
  input: s.object({
    includeGift: s.boolean(),
    quantity: s.number().int().min(1),
  }),
  handler: async (input, request: KovoFixtureRequest) => {
    await request.db.query(
      'insert into enhanced_submit_log (quantity, include_gift) values ($1, $2)',
      [input.quantity, input.includeGift ? 1 : 0],
    );
    return {};
  },
});

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: async (_context, request: KovoFixtureRequest) => `<main>
    <h1>Enhanced submit controls</h1>
    <form method="post" action="/_m/enhanced-submit-controls/submit" enhance
      data-mutation="enhanced-submit-controls/submit" kovo-fragment-target="submit-controls-form">
      <label>Quantity <input name="quantity" type="number" value="2" min="1" /></label>
      <label><input name="includeGift" type="checkbox" value="true" checked /> Include gift wrap</label>
      <input name="adminNote" value="do-not-include" disabled />
      <button type="submit" name="intent" value="confirm">Submit order</button>
      <button type="submit" name="intent" value="preview">Preview order</button>
    </form>
    <div kovo-fragment-target="submit-controls-report">${await renderInitialReport(request.db)}</div>
  </main>`,
});

const app = createApp({
  mutations: [submitOrder],
  routes: [homeRoute],
  mutationResponses: {
    [submitOrder.key]: ({ rawInput }) => {
      const formData = rawInput as FormData;
      return {
        fragmentRenderers: [
          { render: () => renderSubmittedReport(formData), target: 'submit-controls-report' },
        ],
      };
    },
  },
});

export default defineFixture({
  app,
  schema: `create table enhanced_submit_log (
    id integer primary key generated always as identity,
    quantity integer not null,
    include_gift integer not null
  )`,
});
