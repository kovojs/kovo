import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface MessageRow extends Record<string, unknown> {
  body: string;
  id: number;
  role: 'assistant' | 'user';
}

export const chatDomain = domain('chat');

export async function readMessages(
  db: KovoFixtureRequest['db'] | undefined,
): Promise<MessageRow[]> {
  if (!db) throw new Error('streaming chat fixture requires request.db');
  return db.query<MessageRow>(staticSql`select id, role, body from messages order by id`);
}

export const chatQuery = query('chatMessages', {
  load: async (_args: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => ({
    messages: await readMessages(context?.request.db),
  }),
  reads: [chatDomain],
});

export const composerQuery = query('chatComposer', {
  load: () => ({ ready: true }),
  reads: [],
});
