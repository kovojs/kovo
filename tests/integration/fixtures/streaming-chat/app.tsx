/** @jsxImportSource @kovojs/server */
import { createApp, mutation, route, s, stream } from '@kovojs/server';
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { trustedHtml } from '@kovojs/browser';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { Composer } from './composer';
import { Messages } from './messages';
import { chatDomain, chatQuery } from './shared';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export const sendMessage = mutation('chat/send', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  errors: {
    MODEL_UNAVAILABLE: s.object({}),
  },
  input: s.object({
    body: s.string(),
    turns: s.number().int().min(1),
  }),
  registry: {
    queries: [chatQuery],
    tables: ['messages'],
    touches: [chatDomain],
  },
  async handler(input, request: KovoFixtureRequest, context) {
    if (input.body === 'fail') return context.fail('MODEL_UNAVAILABLE', {});

    const rows = await request.db.query<{ next_id: number }>(
      staticSql`select coalesce(max(id), 0) + 1 as next_id from messages`,
    );
    const userId = Number(rows[0]?.next_id ?? 1);
    const assistantId = userId + 1;
    const finalAnswer = `Final answer for ${input.body}: table code image`;
    await request.db.query({
      text: 'insert into messages (id, role, body) values ($1, $2, $3)',
      values: [userId, 'user', input.body],
    });
    await request.db.query({
      text: 'insert into messages (id, role, body) values ($1, $2, $3)',
      values: [assistantId, 'assistant', finalAnswer],
    });
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
  page: () => (
    <main>
      <h1>Streaming chat</h1>
      <Messages />
      <Composer />
    </main>
  ),
});

const app = createApp({
  mutations: [sendMessage],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table messages (id integer primary key, role text not null, body text not null)',
});
