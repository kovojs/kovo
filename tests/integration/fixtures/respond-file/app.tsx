// SPEC.md §6.4: file route outcomes are ordinary guarded routes that return
// declared content type, attachment disposition, and ETag semantics.
import { createApp, guards, respond, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

interface FileSession {
  user: { id: string; roles: readonly string[] };
}
type FileRequest = Request & { session?: FileSession | null };

function readSessionCookie(request: Request): FileSession | null {
  const raw = request.headers.get('cookie') ?? '';
  return raw.includes('respond_file_session=1') ? { user: { id: 'u1', roles: [] } } : null;
}

const exportRoute = route('/exports/orders.csv', {
  guard: guards.authed<FileRequest>(),
  page: () =>
    respond.file('id,total\nord_1,42\n', {
      contentType: 'text/csv; charset=utf-8',
      etag: '"orders-v1"',
      filename: 'orders.csv',
      headers: { 'Cache-Control': 'private, max-age=0' },
    }),
});

export default defineFixture({
  app: createApp<FileSession>({
    routes: [exportRoute],
    sessionProvider: (request) => readSessionCookie(request),
  }),
});
