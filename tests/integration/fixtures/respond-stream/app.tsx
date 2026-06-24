// SPEC.md §6.4: stream route outcomes declare content type/disposition and remain
// guarded routes before a body is streamed.
import { createApp, guards, respond, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

interface StreamSession {
  user: { id: string; roles: readonly string[] };
}
type StreamRequest = Request & { session?: StreamSession | null };

const encoder = new TextEncoder();

function readSessionCookie(request: Request): StreamSession | null {
  const raw = request.headers.get('cookie') ?? '';
  return raw.includes('respond_stream_session=1') ? { user: { id: 'u1', roles: [] } } : null;
}

function textStream(chunks: readonly string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const streamRoute = route('/reports/live.txt', {
  access: { kind: 'guard-chain', guards: [{ name: 'guards.authed' }] },
  guard: guards.authed<StreamRequest>(),
  page: () =>
    respond.stream(textStream(['alpha\n', 'beta\n']), {
      contentType: 'text/plain; charset=utf-8',
      disposition: 'inline',
      filename: 'live.txt',
    }),
});

export default defineFixture({
  app: createApp<StreamSession>({
    routes: [streamRoute],
    sessionProvider: (request) => readSessionCookie(request),
  }),
});
