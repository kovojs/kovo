// SPEC.md §9.1: Kovo-Changes exposes sanitized domain/key summaries only.
import { createApp, domain, mutation, publicAccess, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const auditRecord = domain('audit-record');

export const saveSecret = mutation('sanitized-kovo-changes/save', {
  access: publicAccess('integration fixture mutation sanitized-kovo-changes/save has no runtime guard'),
  csrf: false,
  input: s.object({ id: s.string(), secret: s.string() }),
  handler: async (input: { id: string; secret: string }, request: KovoFixtureRequest, context) => {
    await request.db.exec(
      `insert into audit_records (id, secret) values ('${input.id.replaceAll("'", "''")}', '${input.secret.replaceAll("'", "''")}')`,
    );
    context.invalidate(auditRecord, {
      input: { secret: input.secret, stack: 'internal-stack-detail' },
      keys: [input.id],
      reason: `secret:${input.secret}`,
    });
    return {};
  },
});

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: () => `<main>
    <form method="post" action="/_m/sanitized-kovo-changes/save" enhance data-mutation="sanitized-kovo-changes/save">
      <input name="id" value="r1">
      <input name="secret" value="sensitive-token">
      <button type="submit">Save secret</button>
    </form>
  </main>`,
});

const app = createApp({
  mutations: [saveSecret],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table audit_records (id text primary key, secret text not null)',
});
