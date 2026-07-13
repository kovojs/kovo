// SPEC §9.2/§10.3, §11.4 pillar 5 (plans/bugs-and-testing.md C7; testing-audit §5.1):
// a REAL Postgres constraint violation (unique PK) inside a transactional domain write
// must surface a sanitized server error, roll the whole transaction back, and leave no
// partial/stale state — proving PGlite gives real Postgres failure semantics.
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s } from '@kovojs/server';
import { frameworkManagedDbRawTarget } from '@kovojs/server/internal/execution';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';
import type { PgliteStatementInput } from '@kovojs/test/pglite';

type TxLike = {
  exec(statement: string): Promise<unknown>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    params?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
};

function statementCarrier(
  statement: PgliteStatementInput,
  params: readonly unknown[] = [],
): { text: string; values: readonly unknown[] } {
  if (typeof statement === 'string') return { text: statement, values: params };
  const text = statement.text ?? statement.sql;
  if (typeof text === 'string') return { text, values: statement.values ?? params };
  const chunkText = statement.queryChunks
    ?.flatMap((chunk) => {
      const value = (chunk as { value?: unknown }).value;
      return Array.isArray(value)
        ? value.filter((part): part is string => typeof part === 'string')
        : [];
    })
    .join('');
  if (chunkText) return { text: chunkText, values: statement.values ?? params };
  throw new Error('PGlite transaction statement must include text/sql or queryChunks.');
}

export const duplicateCharge = mutation('pg-constraint-failure/charge', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  input: s.object({ id: s.string() }),
  registry: { tables: ['charges', 'ledger'] },
  transaction: async (request: KovoFixtureRequest, run) =>
    request.db.pglite.transaction(async (tx: TxLike) => {
      const rawTx = (frameworkManagedDbRawTarget(tx) ?? tx) as TxLike;
      return run({
        ...request,
        db: {
          ...request.db,
          exec: async (statement: PgliteStatementInput) => {
            const carrier = statementCarrier(statement);
            if (carrier.values.length === 0) {
              await rawTx.exec(carrier.text);
            } else {
              await rawTx.query(carrier.text, [...carrier.values]);
            }
            return [];
          },
          query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
            statement: PgliteStatementInput,
            params: readonly unknown[] = [],
          ) => {
            const carrier = statementCarrier(statement, params);
            const result = await rawTx.query<Row>(carrier.text, [...carrier.values]);
            return result.rows;
          },
        },
      });
    }),
  handler: async (input, request: KovoFixtureRequest) => {
    // A committed pre-write that MUST roll back when the constraint fails below.
    await request.db.query({
      text: 'insert into ledger (note) values ($1)',
      values: ['attempted'],
    });
    // Duplicate primary key — the database engine raises a real unique violation.
    await request.db.query({
      text: 'insert into charges (id, amount) values ($1, $2)',
      values: [input.id, 200],
    });
    return {};
  },
});

const homeRoute = route('/', {
  page: () => `<main>
    <h1>Constraint failure</h1>
    <div kovo-fragment-target="charge-status" kovo-deps="charge">ready</div>
    <form method="post" action="/_m/pg-constraint-failure/charge">
      <input name="id" value="c1">
      <button type="submit">Charge</button>
    </form>
  </main>`,
});

export default defineFixture({
  app: createApp({
    mutations: [duplicateCharge],
    routes: [homeRoute],
  }),
  schema: [
    'create table charges (id text primary key, amount integer not null)',
    'create table ledger (id integer primary key generated always as identity, note text not null)',
  ],
  seed: (db) => db.exec(staticSql`insert into charges (id, amount) values ('c1', 100)`),
});
