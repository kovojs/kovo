import { describe, expect, it } from 'vitest';

import { extractStaticBuildAnalysisFactsFromProject } from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes } from './test-helpers.js';

const DB_TYPES = pgDatabaseTypes([
  'crossOwnerRead(statement: unknown, declaration: { reads: readonly string[]; reason: string; role: "admin"; site?: string }): Promise<unknown[]>;',
]);

function crossOwnerReadDiagnostics(source: string) {
  return extractStaticBuildAnalysisFactsFromProject({
    files: [
      DB_TYPES,
      {
        fileName: 'src/cross-owner-read.ts',
        source,
      },
    ],
  }).sqlSafetyDiagnostics.filter(
    (diagnostic) =>
      diagnostic.code === 'KV414' && diagnostic.message.includes('crossOwnerRead(...)'),
  );
}

function baseSource(lines: readonly string[]) {
  return [
    'import { endpoint, guards, query } from "@kovojs/server";',
    'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
    '',
    ...lines,
  ].join('\n');
}

describe('@kovojs/drizzle crossOwnerRead static admin-guard proof (DEC-G1)', () => {
  it('accepts a query whose authored crossOwnerRead is guarded by guards.role("admin")', () => {
    const diagnostics = crossOwnerReadDiagnostics(
      baseSource([
        'export const adminNotes = query("adminNotes", {',
        '  guard: guards.role("admin"),',
        '  async load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
        '    return db.crossOwnerRead({}, { reads: ["notes"], reason: "admin export", role: "admin" });',
        '  },',
        '});',
      ]),
    );

    expect(diagnostics).toEqual([]);
  });

  it('accepts an endpoint whose authored crossOwnerRead is guarded by guards.role("admin")', () => {
    const diagnostics = crossOwnerReadDiagnostics(
      baseSource([
        'export const adminExport = endpoint("/admin/export", {',
        '  method: "GET",',
        '  guard: guards.role("admin"),',
        '  reason: "admin export",',
        '  async handler(_request: unknown, context: { db: PgAsyncDatabase<any, any> }) {',
        '    await context.db.crossOwnerRead({}, { reads: ["notes"], reason: "admin export", role: "admin" });',
        '    return new Response("ok");',
        '  },',
        '});',
      ]),
    );

    expect(diagnostics).toEqual([]);
  });

  it('supports guards.all(...) when it explicitly contains guards.role("admin")', () => {
    const diagnostics = crossOwnerReadDiagnostics(
      baseSource([
        'export const adminNotes = query("adminNotes", {',
        '  guard: guards.all(guards.role("admin"), guards.rateLimit({ per: "global", max: 10, windowMs: 1000 })),',
        '  async load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
        '    return db.crossOwnerRead({}, { reads: ["notes"], reason: "admin export", role: "admin" });',
        '  },',
        '});',
      ]),
    );

    expect(diagnostics).toEqual([]);
  });

  it.each([
    {
      label: 'public/no guard',
      source: [
        'export const notes = query("notes", {',
        '  async load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
        '    return db.crossOwnerRead({}, { reads: ["notes"], reason: "unguarded", role: "admin" });',
        '  },',
        '});',
      ],
    },
    {
      label: 'insufficient support role',
      source: [
        'export const notes = query("notes", {',
        '  guard: guards.role("support"),',
        '  async load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
        '    return db.crossOwnerRead({}, { reads: ["notes"], reason: "support export", role: "admin" });',
        '  },',
        '});',
      ],
    },
    {
      label: 'dynamic role',
      source: [
        'const role = "admin" as string;',
        'export const notes = query("notes", {',
        '  guard: guards.role(role),',
        '  async load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
        '    return db.crossOwnerRead({}, { reads: ["notes"], reason: "dynamic export", role: "admin" });',
        '  },',
        '});',
      ],
    },
    {
      label: 'local helper hiding the guard',
      source: [
        'const adminGuard = guards.role("admin");',
        'export const notes = query("notes", {',
        '  guard: adminGuard,',
        '  async load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
        '    return db.crossOwnerRead({}, { reads: ["notes"], reason: "aliased export", role: "admin" });',
        '  },',
        '});',
      ],
    },
    {
      label: 'local shadow of guards.all',
      source: [
        'const localGuards = { all(...items: unknown[]) { return items[0]; }, role(_role: string) { return () => true; } };',
        'export const notes = query("notes", {',
        '  guard: localGuards.all(localGuards.role("admin")),',
        '  async load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
        '    return db.crossOwnerRead({}, { reads: ["notes"], reason: "shadowed export", role: "admin" });',
        '  },',
        '});',
      ],
    },
  ])('fails closed for $label', ({ source }) => {
    const diagnostics = crossOwnerReadDiagnostics(baseSource(source));

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'KV414',
        message: expect.stringContaining('SPEC §10.3'),
        severity: 'error',
      }),
    ]);
    expect(diagnostics[0]?.message).toContain('runtime guard marker is necessary, not sufficient');
  });

  it('fails closed when a helper hides the crossOwnerRead call from the guarded query body', () => {
    const diagnostics = crossOwnerReadDiagnostics(
      baseSource([
        'function readAcrossOwners(db: PgAsyncDatabase<any, any>) {',
        '  return db.crossOwnerRead({}, { reads: ["notes"], reason: "hidden export", role: "admin" });',
        '}',
        'export const adminNotes = query("adminNotes", {',
        '  guard: guards.role("admin"),',
        '  async load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
        '    return readAcrossOwners(db);',
        '  },',
        '});',
      ]),
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('statically dominated');
  });
});
