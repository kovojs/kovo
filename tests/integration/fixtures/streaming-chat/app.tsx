import {
  createApp,
  domain,
  mutation,
  query,
  route,
  s,
  stream,
  type QueryLoadContext,
} from '@kovojs/server';
import { trustedHtml } from '@kovojs/browser';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

interface MessageRow extends Record<string, unknown> {
  body: string;
  id: number;
  role: 'assistant' | 'user';
}

const chatDomain = domain('chat');

const chatQuery = query('chatMessages', {
  load: async (_args: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => ({
    messages: await readMessages(context?.request.db),
  }),
  reads: [chatDomain],
});

async function readMessages(db: KovoFixtureRequest['db'] | undefined): Promise<MessageRow[]> {
  if (!db) throw new Error('streaming chat fixture requires request.db');
  return db.query<MessageRow>('select id, role, body from messages order by id');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderMessage(row: MessageRow): string {
  const liveAttrs = row.role === 'assistant' ? ' aria-live="polite" aria-atomic="true"' : '';
  return `<article data-message-id="${row.id}" data-role="${escapeHtml(row.role)}"${liveAttrs}>
    <p>${escapeHtml(row.body)}</p>
  </article>`;
}

async function renderMessages(db: KovoFixtureRequest['db']): Promise<string> {
  const rows = await readMessages(db);
  return `<section kovo-fragment-target="messages" kovo-deps="chat" aria-label="Messages">
    ${rows.map(renderMessage).join('')}
  </section>`;
}

function renderComposer(errorCode = ''): string {
  return `<form
    method="post"
    action="/_m/chat/send"
    enhance
    data-mutation="chat/send"
    data-mutation-stream="true"
    kovo-fragment-target="composer"
    kovo-deps="chat"
  >
    <label>Message <textarea name="body">show table</textarea></label>
    <input type="hidden" name="turns" value="1" />
    ${errorCode ? `<output role="alert" data-error-code="${escapeHtml(errorCode)}">Unable to send</output>` : ''}
    <button type="submit">Send</button>
  </form>`;
}

export const sendMessage = mutation('chat/send', {
  csrf: false,
  errors: {
    MODEL_UNAVAILABLE: s.object({}),
  },
  input: s.object({
    body: s.string(),
    turns: s.number().int().min(1),
  }),
  registry: {
    queries: [chatQuery],
    touches: [chatDomain],
  },
  async handler(input, request: KovoFixtureRequest, context) {
    if (input.body === 'fail') return context.fail('MODEL_UNAVAILABLE', {});

    const rows = await request.db.query<{ next_id: number }>(
      'select coalesce(max(id), 0) + 1 as next_id from messages',
    );
    const userId = Number(rows[0]?.next_id ?? 1);
    const assistantId = userId + 1;
    const finalAnswer = `Final answer for ${input.body}: table code image`;
    await request.db.query('insert into messages (id, role, body) values ($1, $2, $3)', [
      userId,
      'user',
      input.body,
    ]);
    await request.db.query('insert into messages (id, role, body) values ($1, $2, $3)', [
      assistantId,
      'assistant',
      finalAnswer,
    ]);
    return { assistantId, body: input.body, finalAnswer, userId };
  },
  async *stream({ result }) {
    yield stream.fragment({
      html: trustedHtml(
        `<article data-message-id="${result.value.userId}" data-role="user"><p>${escapeHtml(result.value.body)}</p></article>`,
      ),
      mode: 'append',
      target: 'messages',
    });
    yield stream.fragment({
      html: trustedHtml(`<article data-message-id="${result.value.assistantId}" data-role="assistant" aria-live="polite" aria-atomic="true">
        <p
          data-stream-text="assistant:${escapeHtml(String(result.value.assistantId))}"
          data-stream-renderer="/client.ts#renderMarkdownStream"
        ></p>
      </article>`),
      mode: 'append',
      target: 'messages',
    });
    yield stream.text(`assistant:${result.value.assistantId}`, '| Col | Value |');
    yield stream.text(`assistant:${result.value.assistantId}`, '\n| --- | --- |');
    yield stream.text(`assistant:${result.value.assistantId}`, '\n```ts\nconst ok = true;\n```');
    yield stream.text(
      `assistant:${result.value.assistantId}`,
      '| Col | Value |\n| --- | --- |\n```ts\nconst ok = true;\n```\n![alt](image.png)',
      {
        mode: 'checkpoint',
      },
    );
    yield stream.text(`assistant:${result.value.assistantId}`, '\nFinal answer');
    if (result.value.body === 'xss-probe') {
      // Model output with HTML metacharacters + a </kovo-text> break-out attempt:
      // Kovo owns the escaped source buffer (SPEC §9.1), so the <kovo-text> wire
      // chunk must escape it and it can never end the element or inject markup.
      yield stream.text(
        `assistant:${result.value.assistantId}`,
        '<img src=x onerror=alert(1)></kovo-text><script>alert(2)</script>',
      );
    }
    if (result.value.body === 'abort') {
      yield stream.done({ reason: 'error' });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => `<main>
    <h1>Streaming chat</h1>
    ${await renderMessages(request.db)}
    ${renderComposer()}
  </main>`,
});

const app = createApp({
  mutations: [sendMessage],
  queries: [chatQuery],
  routes: [homeRoute],
  mutationResponses: {
    [sendMessage.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        fragmentRenderers: [{ render: () => renderMessages(db), target: 'messages' }],
        redirectTo: '/',
        renderFailureFragment: (failure) => renderComposer(failure.error.code),
      };
    },
  },
});

export default defineFixture({
  app,
  schema: 'create table messages (id integer primary key, role text not null, body text not null)',
});
