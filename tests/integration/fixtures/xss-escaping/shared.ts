import { domain, publicAccess, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

// Output-safety conformance fixture (SPEC §4.8/§5.2 #10 / KV236, §9.1 script-data
// encoding). The framework's primary security claim — output is escaped by
// construction — had zero integration coverage (plans/bugs-and-testing.md C1;
// testing-audit §4). This fixture drives user-controlled HTML metacharacters and
// a `javascript:` URL through real rendering paths and asserts they are neutralized.

export interface PayloadResult {
  [key: string]: unknown;
  text: string;
  url: string;
}

export const xssDomain = domain('xss');

export async function readPayload(db: KovoFixtureRequest['db']): Promise<PayloadResult> {
  const rows = await db.query<PayloadResult>('select text, url from xss_payload where id = 1');
  return rows[0] ?? { text: '', url: '' };
}

export const payloadQuery = query('payload', {
  access: publicAccess('integration fixture query payload has no runtime guard'),
  reads: [xssDomain],
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('payload query requires request.db');
    return readPayload(db);
  },
});
