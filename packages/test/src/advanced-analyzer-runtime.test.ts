import type * as CoreGraph from '@kovojs/core/internal/graph';
import {
  diagnosticsForTouchGraph,
  extractQueryFactsFromProject,
  extractTouchGraphFromProject,
  type SourceFileInput,
} from '@kovojs/drizzle/internal/static';
import { afterEach, describe, expect, it } from 'vitest';

import { createPgliteTestDb, type PgliteTestDb } from './pglite.js';
import { createDbVerifier } from './verifier.js';

function pgDatabaseTypes(methods: readonly string[]): SourceFileInput {
  return {
    fileName: 'drizzle-types.d.ts',
    source: [
      'import "drizzle-orm/pg-core";',
      'declare module "drizzle-orm/pg-core" {',
      '  export interface PgAsyncDatabase<TQueryResultHKT = unknown, TFullSchema = unknown> {',
      ...methods.map((method) => `    ${method}`),
      '  }',
      '}',
      'type PgAsyncDatabase<TQueryResultHKT = unknown, TFullSchema = unknown> = import("drizzle-orm/pg-core").PgAsyncDatabase<TQueryResultHKT, TFullSchema>;',
    ].join('\n'),
  };
}

const scopedTicketFiles: SourceFileInput[] = [
  pgDatabaseTypes([
    'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
    'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
  ]),
  {
    fileName: 'ticket.pipeline.ts',
    source: [
      'import { and, eq } from "drizzle-orm";',
      'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
      'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
      '',
      'export const tickets = pgTable("tickets", {',
      '  tenantId: text("tenant_id").notNull(),',
      '  id: text("id").notNull(),',
      '  status: text("status").notNull(),',
      '}, kovo({ domain: "ticket", key: "tenantId,id" }));',
      '',
      'function currentTenantId(context: { request?: { session?: { tenantId?: string } | null } }) {',
      '  if (!context.request?.session?.tenantId) throw new Error("tenant required");',
      '  return context.request.session.tenantId;',
      '}',
      'kovoAnalyzerSummary(currentTenantId, { returns: { kind: "tenant", path: "id" } });',
      '',
      'export const openTickets = query("openTickets", {',
      '  async load(_input: {}, db: PgAsyncDatabase<any, any>, context: { request?: { session?: { tenantId?: string } | null } }) {',
      '    const tenantId = currentTenantId(context);',
      '    return {',
      '      items: await db.select({ id: tickets.id, status: tickets.status }).from(tickets).where(eq(tickets.tenantId, tenantId)),',
      '    };',
      '  },',
      '});',
      '',
      'export async function closeTicket(db: PgAsyncDatabase<any, any>, context: { request?: { session?: { tenantId?: string } | null } }, ticketId: string) {',
      '  const tenantId = currentTenantId(context);',
      '  await db.update(tickets).set({ status: "closed" }).where(and(eq(tickets.tenantId, tenantId), eq(tickets.id, ticketId)));',
      '}',
    ].join('\n'),
  },
];

let activeDb: PgliteTestDb | undefined;

afterEach(async () => {
  await activeDb?.close();
  activeDb = undefined;
});

describe('advanced analyzer runtime cross-checks', () => {
  it('verifies scoped PGlite writes and reads against extracted static facts', async () => {
    const touchGraph = extractTouchGraphFromProject({ files: scopedTicketFiles });
    expect(diagnosticsForTouchGraph(touchGraph)).toEqual([]);
    expect(touchGraph.closeTicket?.touches).toMatchObject([
      {
        domain: 'ticket',
        keys: 'arg:ticketId',
        via: 'tickets',
      },
    ]);

    const openTickets = extractQueryFactsFromProject({ files: scopedTicketFiles }).find(
      (candidate) => candidate.query === 'openTickets',
    );
    expect(openTickets).toMatchObject({
      query: 'openTickets',
      reads: ['ticket'],
    });
    expect(openTickets?.instanceKey).toBeUndefined();

    const staticTouch = touchGraph.closeTicket?.touches[0];
    if (!staticTouch) throw new Error('expected closeTicket touch');
    const verificationGraph: CoreGraph.TouchGraph = {
      ...touchGraph,
      'ticket.unexercisedReopen': {
        touches: [
          {
            ...staticTouch,
            branch: 'unexercised-reopen',
            site: 'ticket.pipeline.ts:unexercised',
          },
        ],
        unresolved: [],
      },
    };

    const db = await createPgliteTestDb();
    activeDb = db;
    await db.exec(
      'create table tickets (tenant_id text not null, id text not null, status text not null, primary key (tenant_id, id))',
    );
    await db.query(
      'insert into tickets (tenant_id, id, status) values ($1, $2, $3), ($4, $5, $6)',
      ['tenant-a', 't1', 'open', 'tenant-b', 't1', 'open'],
    );

    const verifier = createDbVerifier(verificationGraph, {
      domainByTable: { tickets: 'ticket' },
      sqlDialect: 'postgres',
    });
    const observedDb = verifier.wrap(db);

    const read = await verifier.capture(() =>
      observedDb.query<{ id: string; status: string }>(
        'select id, status from tickets where tenant_id = $1 order by id',
        ['tenant-a'],
      ),
    );
    expect(read.result).toEqual([{ id: 't1', status: 'open' }]);
    verifier.assertReadsCoveredOperations(read.observed, openTickets?.reads ?? []);

    const write = await verifier.capture(() =>
      observedDb.query('update tickets set status = $1 where tenant_id = $2 and id = $3', [
        'closed',
        'tenant-a',
        't1',
      ]),
    );
    verifier.assertCoveredOperations(write.observed, 'closeTicket');

    const after = await db.query<{ id: string; status: string; tenant_id: string }>(
      'select tenant_id, id, status from tickets order by tenant_id, id',
    );
    expect(after).toEqual([
      { id: 't1', status: 'closed', tenant_id: 'tenant-a' },
      { id: 't1', status: 'open', tenant_id: 'tenant-b' },
    ]);

    expect(verifier.diagnostics()).toEqual([
      {
        branch: 'unexercised-reopen',
        code: 'KV405',
        domain: 'ticket',
        message: 'Conditional write branch was never executed under instrumentation.',
        severity: 'error',
        site: 'ticket.pipeline.ts:unexercised',
      },
    ]);
  });
});
