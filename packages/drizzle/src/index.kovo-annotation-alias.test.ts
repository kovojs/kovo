import { describe, expect, it } from 'vitest';

import {
  extractMassAssignmentFromProject,
  extractOwnerAuditFromProject,
  type SourceFileInput,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes, withPgDatabaseTypes } from './test-helpers.js';

const dbTypes = pgDatabaseTypes([
  'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
  'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
]);

const domainFile: SourceFileInput = {
  fileName: 'account.domain.ts',
  source: [
    'import { eq } from "drizzle-orm";',
    'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
    'import { accounts } from "./schema";',
    '',
    'export const accountById = query("account", {',
    '  output: s.object({ id: s.string() }),',
    '  async load(input, db: PgAsyncDatabase<any, any>) {',
    '    return db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, input.id));',
    '  },',
    '});',
    '',
    'export const updateAccount = async (db: PgAsyncDatabase<any, any>, input: { id: string; role: string }) => {',
    '  await db.update(accounts).set({ role: input.role }).where(eq(accounts.id, input.id));',
    '};',
  ].join('\n'),
};

function schemaFile(kovoImport: string, kovoCall: string): SourceFileInput {
  return {
    fileName: 'schema.ts',
    source: [
      kovoImport,
      '',
      'export const accounts = pgTable("accounts", {',
      '  id: text("id").primaryKey(),',
      '  ownerId: text("owner_id").notNull(),',
      '  role: text("role").notNull(),',
      `}, ${kovoCall}({ domain: "account", key: "id", owner: "ownerId", governed: ["role"] }));`,
    ].join('\n'),
  };
}

function files(kovoImport: string, kovoCall: string): SourceFileInput[] {
  return [dbTypes, schemaFile(kovoImport, kovoCall), domainFile];
}

describe('@kovojs/drizzle kovo() table annotation import bindings', () => {
  it('preserves owner, scope, and mass-assignment facts for an aliased kovo import', () => {
    const projectFiles = files('import { kovo as kv } from "@kovojs/drizzle";', 'kv');

    const ownerAudit = extractOwnerAuditFromProject(withPgDatabaseTypes({ files: projectFiles }));
    expect(ownerAudit.ownerDomains).toEqual([{ domain: 'account', owner: 'ownerId' }]);
    expect(
      ownerAudit.scopeAudits.map((audit) => ({
        domain: audit.domain,
        kind: audit.kind,
        name: audit.name,
        scope: audit.scope,
      })),
    ).toContainEqual({ domain: 'account', kind: 'query', name: 'account', scope: 'args' });

    expect(extractMassAssignmentFromProject({ files: projectFiles })).toEqual([
      {
        column: 'role',
        detail: 'role',
        domain: 'account',
        name: 'updateAccount',
        provenance: 'input',
        site: 'account.domain.ts:13',
        via: 'set',
      },
    ]);
  });

  it('preserves owner, scope, and mass-assignment facts for a namespace kovo import', () => {
    const projectFiles = files('import * as d from "@kovojs/drizzle";', 'd.kovo');

    const ownerAudit = extractOwnerAuditFromProject(withPgDatabaseTypes({ files: projectFiles }));
    expect(ownerAudit.ownerDomains).toEqual([{ domain: 'account', owner: 'ownerId' }]);
    expect(
      ownerAudit.scopeAudits.map((audit) => ({
        domain: audit.domain,
        kind: audit.kind,
        name: audit.name,
        scope: audit.scope,
      })),
    ).toContainEqual({ domain: 'account', kind: 'query', name: 'account', scope: 'args' });

    expect(extractMassAssignmentFromProject({ files: projectFiles })).toEqual([
      {
        column: 'role',
        detail: 'role',
        domain: 'account',
        name: 'updateAccount',
        provenance: 'input',
        site: 'account.domain.ts:13',
        via: 'set',
      },
    ]);
  });
});
