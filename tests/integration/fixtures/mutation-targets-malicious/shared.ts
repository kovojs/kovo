import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export const targetPublic = domain('targetPublic');
export const targetPrivate = domain('targetPrivate');

export function userId(request: Request): string | null {
  const raw = request.headers.get('cookie') ?? '';
  const entry = raw
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('kovo_target_session='));
  if (!entry) return null;
  return decodeURIComponent(entry.slice('kovo_target_session='.length)) || null;
}

export const publicTargetQuery = query('publicTarget', {
  reads: [targetPublic],
  load: async (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('public target query requires request.db');
    const rows = await db.query<{ count: number }>(
      staticSql`select count(*)::int as count from target_refreshes`,
    );
    return { count: Number(rows[0]?.count ?? 0) };
  },
});

export const privateTargetQuery = query('privateTarget', {
  reads: [targetPrivate],
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const request = context?.request;
    const id = request ? userId(request) : null;
    if (!id) throw new Error('private target query requires an authenticated request');
    return { id };
  },
});
