import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  analyzeBetterAuthApiV1Migration,
  runBetterAuthApiV1Migration,
} from './migrate-better-auth-api-v1.mjs';

describe('Better Auth generated-assembly migration executable', () => {
  it('splits human, neutral, Postgres, and SQLite imports while preserving local names', () => {
    const source = [
      "import { authed, type BetterAuthDevelopmentSeed, createBetterAuthPostgresBindingsFromEnvironment as pg, betterAuthSqliteSecret, type BetterAuthBindingRequest as Request } from '@kovojs/better-auth';",
      "export { type BetterAuthPostgresBindings, createBetterAuthSqliteBindings } from '@kovojs/better-auth';",
      '',
    ].join('\n');

    const result = analyzeBetterAuthApiV1Migration({ fileName: 'app.ts', source });

    expect(result.status).toBe('rewritten');
    if (result.status !== 'rewritten') return;
    expect(result.source).toBe(
      [
        "import { authed } from '@kovojs/better-auth';",
        "import { type BetterAuthDevelopmentSeed, type BetterAuthGeneratedRequest as Request } from '@kovojs/better-auth/generated';",
        "import { createBetterAuthPostgresBindingsFromEnvironment as pg } from '@kovojs/better-auth/generated/postgres';",
        "import { betterAuthSqliteSecret } from '@kovojs/better-auth/generated/sqlite';",
        "export { type BetterAuthPostgresBindings } from '@kovojs/better-auth/generated/postgres';",
        "export { createBetterAuthSqliteBindings } from '@kovojs/better-auth/generated/sqlite';",
        '',
      ].join('\n'),
    );
  });

  it('keeps a write batch unchanged when one retired carrier needs explicit auth posture', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-better-auth-api-v1-'));
    const rewritePath = path.join(root, 'generated.ts');
    const refusalPath = path.join(root, 'carrier.ts');
    const rewriteSource =
      "import { authed, createBetterAuthPostgresBindings } from '@kovojs/better-auth';\nvoid authed;\nvoid createBetterAuthPostgresBindings;\n";
    const refusalSource =
      "import type { BetterAuthCredentialMutationValue } from '@kovojs/better-auth';\nexport type Result = BetterAuthCredentialMutationValue;\n";

    try {
      writeFileSync(rewritePath, rewriteSource);
      writeFileSync(refusalPath, refusalSource);
      const result = runBetterAuthApiV1Migration({
        cwd: root,
        mode: 'write',
        sourcePaths: ['generated.ts', 'carrier.ts'],
      });

      expect(result.schema).toBe('kovo-api-migration-result/v1');
      expect(result.batch).toBe('better-auth-generated-assembly-v1');
      expect(result.summary).toEqual({ refused: 1, rewritten: 1, unchanged: 0 });
      expect(readFileSync(rewritePath, 'utf8')).toBe(rewriteSource);
      expect(readFileSync(refusalPath, 'utf8')).toBe(refusalSource);
      expect(result.files[0]).toMatchObject({
        path: 'carrier.ts',
        state: 'refused',
        refusals: [{ category: 'auth-posture' }],
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('names the app-owned auth decision behind the retired credential carrier', () => {
    const result = analyzeBetterAuthApiV1Migration({
      fileName: 'carrier.ts',
      source:
        "import type { BetterAuthCredentialMutationValue } from '@kovojs/better-auth';\nexport type Result = BetterAuthCredentialMutationValue;\n",
    });

    expect(result.status).toBe('refused');
    if (result.status !== 'refused') return;
    expect(result.refusals).toEqual([
      expect.objectContaining({
        category: 'auth-posture',
        reason: expect.stringContaining('guard or session authority'),
      }),
    ]);
  });

  it('atomically replaces a fully mechanical write batch', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-better-auth-api-v1-'));
    const sourcePath = path.join(root, 'generated.ts');

    try {
      writeFileSync(
        sourcePath,
        "import type { BetterAuthBindingRequest } from '@kovojs/better-auth';\nexport type Request = BetterAuthBindingRequest;\n",
      );
      const result = runBetterAuthApiV1Migration({
        cwd: root,
        mode: 'write',
        sourcePaths: ['generated.ts'],
      });

      expect(result.summary).toEqual({ refused: 0, rewritten: 1, unchanged: 0 });
      expect(readFileSync(sourcePath, 'utf8')).toBe(
        [
          "import type { BetterAuthGeneratedRequest as BetterAuthBindingRequest } from '@kovojs/better-auth/generated';",
          'export type Request = BetterAuthBindingRequest;',
          '',
        ].join('\n'),
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.each([
    ["import auth from '@kovojs/better-auth';", 'ambiguous-binding'],
    ["import * as auth from '@kovojs/better-auth';", 'ambiguous-binding'],
    ["export * from '@kovojs/better-auth';", 'ambiguous-binding'],
    ["const auth = await import('@kovojs/better-auth');", 'dynamic-import'],
    ["const auth = require('@kovojs/better-auth');", 'dynamic-import'],
    ["type Auth = import('@kovojs/better-auth');", 'dynamic-import'],
  ])('refuses ambiguous root access: %s', (source, category) => {
    const result = analyzeBetterAuthApiV1Migration({ fileName: 'ambiguous.ts', source });

    expect(result.status).toBe('refused');
    if (result.status !== 'refused') return;
    expect(result.refusals[0]?.category).toBe(category);
  });

  it('serializes refusal anchors as UTF-8 byte ranges', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-better-auth-api-v1-'));
    const sourcePath = path.join(root, 'carrier.ts');
    const source =
      "// π is two bytes\nimport type { BetterAuthCredentialMutationValue } from '@kovojs/better-auth';\n";

    try {
      writeFileSync(sourcePath, source);
      const result = runBetterAuthApiV1Migration({
        cwd: root,
        mode: 'check',
        sourcePaths: ['carrier.ts'],
      });
      const refusal = result.files[0]?.refusals?.[0];

      expect(refusal?.anchor.start).toBe(
        Buffer.byteLength(source.slice(0, source.indexOf('BetterAuthCredentialMutationValue'))),
      );
      expect(refusal?.anchor.end).toBe(
        refusal.anchor.start + Buffer.byteLength('BetterAuthCredentialMutationValue'),
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
