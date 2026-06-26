// SPEC.md §6.4: file route outcomes are ordinary guarded routes that return
// declared content type, attachment disposition, and ETag semantics.
import { createApp, guards, respond, route } from '@kovojs/server';
import {
  defineFixture,
  delegatedFixtureSessionProvider,
} from '@kovojs/test/internal/integration/define';

interface FileSession {
  user: { id: string; roles: readonly string[] };
}
type FileRequest = Request & { session?: FileSession | null };

function readSessionCookie(request: Request): FileSession | null {
  const raw = request.headers.get('cookie') ?? '';
  return raw.includes('respond_file_session=1') ? { user: { id: 'u1', roles: [] } } : null;
}

const exportRoute = route('/downloads/orders.pdf', {
  guard: guards.authed<FileRequest>(),
  page: () =>
    respond.file('%PDF-1.7\n', {
      contentType: 'application/pdf',
      etag: '"orders-pdf-v1"',
      filename: 'orders.pdf',
      headers: { 'Cache-Control': 'private, max-age=0' },
    }),
});

export default defineFixture({
  app: createApp<FileSession>({
    routes: [exportRoute],
    sessionProvider: delegatedFixtureSessionProvider((request) => readSessionCookie(request)),
  }),
});
