// SPEC §9.2/§10.3, §11.4 pillar 5 (plans/bugs-and-testing.md C7; testing-audit §5.1):
// a REAL Postgres constraint violation (unique PK) inside a transactional domain write
// must surface a sanitized server error, roll the whole transaction back, and leave no
// partial/stale state — proving PGlite gives real Postgres failure semantics.
import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

type TxLike = {
  exec(statement: string): Promise<unknown>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    params?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
};

export const duplicateCharge = mutation('pg-constraint-failure/charge', {
  access: publicAccess('integration fixture mutation pg-constraint-failure/charge has no runtime guard'),
  csrf: false,
  input: s.object({ id: s.string() }),
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
    // A committed pre-write that MUST roll back when the constraint fails below.
    await request.db.query('insert into ledger (note) values ($1)', ['attempted']);
    // Duplicate primary key — the database engine raises a real unique violation.
    await request.db.query('insert into charges (id, amount) values ($1, $2)', [input.id, 200]);
    return {};
  },
});

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
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
    mutationResponses: {
      [duplicateCharge.key]: () => ({ failureTarget: 'charge-status' }),
    },
    routes: [homeRoute],
  }),
  schema: [
    'create table charges (id text primary key, amount integer not null)',
    'create table ledger (id integer primary key generated always as identity, note text not null)',
  ],
  seed: (db) => db.exec("insert into charges (id, amount) values ('c1', 100)"),
});
