// SPEC.md §9.2/§10.3: unexpected mutation failures inside a configured
// transaction roll back writes and return sanitized server-error responses.
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

type TxLike = {
  exec(statement: string): Promise<unknown>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    params?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
};

export const failAfterWrite = mutation('rollback/fail-after-write', {
  csrf: false,
  input: s.object({ note: s.string() }),
  transaction: async (request: KovoFixtureRequest, run) =>
    request.db.pglite.transaction(async (tx: TxLike) =>
      run({
        ...request,
        db: {
          ...request.db,
          exec: async (statement: string) => {
            await tx.exec(statement);
            return [];
          },
          query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
            statement: string,
            params: readonly unknown[] = [],
          ) => {
            const result = await tx.query<Row>(statement, [...params]);
            return result.rows;
          },
        },
      }),
    ),
  handler: async (input, request: KovoFixtureRequest) => {
    await request.db.query('insert into rollback_events (note) values ($1)', [input.note]);
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
    mutationResponse: ({ key }) => {
      if (key !== failAfterWrite.key) return undefined;
      return { failureTarget: 'rollback-status' };
    },
    routes: [homeRoute],
  }),
  schema: `create table rollback_events (
    id integer primary key generated always as identity,
    note text not null
  )`,
});
