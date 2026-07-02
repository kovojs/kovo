// SPEC.md §9.2/§10.3: unexpected mutation failures inside a configured
// transaction roll back writes and return sanitized server-error responses.
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

export const failAfterWrite = mutation('rollback/fail-after-write', {
  csrf: false,
  input: s.object({ note: s.string() }),
  registry: { tables: ['rollback_events'] },
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
    await request.db.query({
      text: 'insert into rollback_events (note) values ($1)',
      values: [input.note],
    });
    throw new Error('internal stack detail: do not leak');
  },
});

const homeRoute = route('/', {
  page: () => `<main>
    <h1>Rollback failure</h1>
    <div kovo-fragment-target="rollback-status" kovo-deps="rollback">ready</div>
    <form method="post" action="/_m/rollback/fail-after-write">
      <input name="note" value="before-crash">
      <button type="submit">Fail after write</button>
    </form>
  </main>`,
});

export default defineFixture({
  app: createApp({
    mutations: [failAfterWrite],
    mutationResponses: {
      [failAfterWrite.key]: () => {
        return { failureTarget: 'rollback-status' };
      },
    },
    routes: [homeRoute],
  }),
  schema: `create table rollback_events (
    id integer primary key generated always as identity,
    note text not null
  )`,
});
