import { describe, expect, it } from 'vitest';

import {
  extractSymbolicEffectsFromProject,
  extractTouchGraphFromProject,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes } from './test-helpers.js';

describe('@kovojs/drizzle mutation private-scope transfers', () => {
  it('keeps exact summarized request projections out of KV406 without hiding DB writes', () => {
    // @kovo-security-certifies C13 handler-semantic-summary-direct-request-transfer
    const files = [
      pgDatabaseTypes([
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'account.mutations.ts',
        source: [
          'import { eq } from "drizzle-orm";',
          'import { pgTable, text, type PgAsyncDatabase } from "drizzle-orm/pg-core";',
          'import { kovo, kovoAnalyzerSummary } from "@kovojs/drizzle";',
          'import { mutation } from "@kovojs/server";',
          '',
          'export const accounts = pgTable("accounts", { id: text("id").primaryKey(), tenantId: text("tenant_id").notNull() }, kovo({ domain: "account", key: "id" }));',
          '',
          'function requestTenantId(request: { tenant: { id: string } }) { return request.tenant.id; }',
          'function unsummarizedTenantId(request: { tenant: { id: string } }) { return request.tenant.id; }',
          'kovoAnalyzerSummary(requestTenantId, { returns: { kind: "tenant", path: "id" } });',
          'const helperContainer = { requestTenantId };',
          'const helperAlias = requestTenantId;',
          'let reboundTenantId = (request: { tenant: { id: string } }) => request.tenant.id;',
          'kovoAnalyzerSummary(reboundTenantId, { returns: { kind: "tenant", path: "id" } });',
          'reboundTenantId = (request) => `rebound:${request.tenant.id}`;',
          'async function sharedSave({ id: targetId }: { id: string }, request: { db: PgAsyncDatabase<any, any> }) {',
          '  await request.db.update(accounts).set({ tenantId: "shared" }).where(eq(accounts.id, targetId));',
          '}',
          '',
          'export const exact = mutation("account/exact", {',
          '  async handler({ id: targetId }: { id: string }, request: { db: PgAsyncDatabase<any, any>; tenant: { id: string } }) {',
          '    const tenantId = requestTenantId(request);',
          '    await request.db.update(accounts).set({ tenantId }).where(eq(accounts.id, targetId));',
          '  },',
          '});',
          '',
          'export const adjacent = mutation("account/adjacent", {',
          '  async handler(input: { id: string }, request: { db: PgAsyncDatabase<any, any>; tenant: { id: string } }) {',
          '    const tenantId = unsummarizedTenantId(request);',
          '    await request.db.update(accounts).set({ tenantId }).where(eq(accounts.id, input.id));',
          '  },',
          '});',
          '',
          'export const property = mutation("account/property", {',
          '  async handler(input: { id: string }, request: { db: PgAsyncDatabase<any, any>; tenant: { id: string } }) {',
          '    const tenantId = helperContainer.requestTenantId(request);',
          '    await request.db.update(accounts).set({ tenantId }).where(eq(accounts.id, input.id));',
          '  },',
          '});',
          '',
          'export const alias = mutation("account/alias", {',
          '  async handler(input: { id: string }, request: { db: PgAsyncDatabase<any, any>; tenant: { id: string } }) {',
          '    const tenantId = helperAlias(request);',
          '    await request.db.update(accounts).set({ tenantId }).where(eq(accounts.id, input.id));',
          '  },',
          '});',
          '',
          'export const rebound = mutation("account/rebound", {',
          '  async handler(input: { id: string }, request: { db: PgAsyncDatabase<any, any>; tenant: { id: string } }) {',
          '    const tenantId = reboundTenantId(request);',
          '    await request.db.update(accounts).set({ tenantId }).where(eq(accounts.id, input.id));',
          '  },',
          '});',
          'export const sharedOne = mutation("account/shared-one", { handler: sharedSave });',
          'export const sharedTwo = mutation("account/shared-two", { handler: sharedSave });',
        ].join('\n'),
      },
    ];
    const graph = extractTouchGraphFromProject({ files });

    expect(graph['account/exact']).toEqual({
      reads: [],
      touches: [
        expect.objectContaining({
          domain: 'account',
          via: 'accounts',
        }),
      ],
      unresolved: [],
    });
    expect(graph['account/adjacent']).toMatchObject({
      touches: [expect.objectContaining({ domain: 'account', via: 'accounts' })],
      unresolved: [expect.objectContaining({ code: 'KV406' })],
    });
    expect(graph['account/property']).toMatchObject({
      touches: [expect.objectContaining({ domain: 'account', via: 'accounts' })],
      unresolved: [expect.objectContaining({ code: 'KV406' })],
    });
    expect(graph['account/alias']).toMatchObject({
      touches: [expect.objectContaining({ domain: 'account', via: 'accounts' })],
      unresolved: [expect.objectContaining({ code: 'KV406' })],
    });
    expect(graph['account/rebound']).toMatchObject({
      touches: [expect.objectContaining({ domain: 'account', via: 'accounts' })],
      unresolved: [expect.objectContaining({ code: 'KV406' })],
    });

    const effects = extractSymbolicEffectsFromProject({ files });
    expect(effects.find((candidate) => candidate.writeKey === 'account/exact')).toMatchObject({
      effect: {
        match: {
          eq: [{ column: 'id', value: { kind: 'param', path: 'targetId' } }],
          kind: 'keys',
        },
        op: 'update',
        table: 'accounts',
      },
      writeKey: 'account/exact',
    });
    expect(
      effects
        .filter((candidate) => candidate.writeKey?.startsWith('account/shared-'))
        .map((candidate) => candidate.writeKey)
        .sort(),
    ).toEqual(['account/shared-one', 'account/shared-two']);
  });
});
