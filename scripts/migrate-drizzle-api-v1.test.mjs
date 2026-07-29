import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  analyzeDrizzleApiV1Migration,
  runDrizzleApiV1Migration,
} from './migrate-drizzle-api-v1.mjs';

describe('Drizzle typed-annotation API migration executable', () => {
  it('rewrites direct, composite, owner-via, and fan-out column references', () => {
    const result = analyzeDrizzleApiV1Migration({
      fileName: 'schema.ts',
      source: `
        import { kovo as annotate } from '@kovojs/drizzle';
        const accounts = pgTable('accounts', { id: text('id') });
        const entries = pgTable('entries', {}, annotate({
          domain: 'entry',
          fans: [{ domain: 'account', via: 'accountId' }],
          key: 'accountId,id',
          ownerVia: { fk: 'accountId', parent: accounts, parentKey: 'id' },
          secret: ['secret'],
        }));
      `,
    });

    expect(result.status).toBe('rewritten');
    expect(result.source).toContain('annotate((columns) => ({');
    expect(result.source).toContain('key: [columns.accountId, columns.id]');
    expect(result.source).toContain('via: columns.accountId');
    expect(result.source).toContain(
      'ownerVia: { fk: columns.accountId, parent: accounts, parentKey: accounts.id }',
    );
    expect(result.source).toContain('secret: [columns.secret]');
  });

  it('keeps a whole write batch unchanged when runtime metadata or dynamic syntax is refused', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-drizzle-api-v1-'));
    const rewritePath = path.join(root, 'schema.ts');
    const refusalPath = path.join(root, 'metadata.ts');
    const rewriteSource =
      "import { kovo } from '@kovojs/drizzle';\nexport const config = kovo({ domain: 'entry', key: 'id' });\n";
    const refusalSource =
      "import type { KovoRuntimeDbMetadata } from '@kovojs/drizzle';\nexport type Metadata = KovoRuntimeDbMetadata;\n";

    try {
      writeFileSync(rewritePath, rewriteSource);
      writeFileSync(refusalPath, refusalSource);

      const result = runDrizzleApiV1Migration({
        cwd: root,
        mode: 'write',
        sourcePaths: ['schema.ts', 'metadata.ts'],
      });

      expect(result.schema).toBe('kovo-api-migration-result/v1');
      expect(result.batch).toBe('drizzle-typed-annotations-v1');
      expect(result.summary).toEqual({ refused: 1, rewritten: 1, unchanged: 0 });
      expect(result.files[0]?.refusals?.[0]?.category).toBe('app-context');
      expect(result.files[0]?.refusals?.[0]?.anchor).toEqual({
        start: expect.any(Number),
        end: expect.any(Number),
      });
      expect(readFileSync(rewritePath, 'utf8')).toBe(rewriteSource);
      expect(readFileSync(refusalPath, 'utf8')).toBe(refusalSource);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('atomically writes a fully mechanical callback conversion', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-drizzle-api-v1-'));
    const sourcePath = path.join(root, 'schema.ts');

    try {
      writeFileSync(
        sourcePath,
        "import { kovo } from '@kovojs/drizzle';\nexport const config = kovo({ domain: 'entry', key: 'id' });\n",
      );

      const result = runDrizzleApiV1Migration({
        cwd: root,
        mode: 'write',
        sourcePaths: ['schema.ts'],
      });

      expect(result.summary).toEqual({ refused: 0, rewritten: 1, unchanged: 0 });
      expect(readFileSync(sourcePath, 'utf8')).toContain(
        "kovo((columns) => ({ domain: 'entry', key: columns.id }))",
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not treat comments or unrelated file scopes as annotation parameter collisions', () => {
    const result = analyzeDrizzleApiV1Migration({
      fileName: 'schema.ts',
      source: `
        import { kovo } from '@kovojs/drizzle';
        const columns = ['unrelated'];
        // The concrete columns are supplied by Drizzle.
        export const config = kovo({ domain: 'entry', key: 'id' });
      `,
    });

    expect(result.status).toBe('rewritten');
    expect(result.source).toContain("kovo((columns) => ({ domain: 'entry', key: columns.id }))");
  });

  it('refuses dynamic annotation composition without guessing app intent', () => {
    const result = analyzeDrizzleApiV1Migration({
      fileName: 'schema.ts',
      source:
        "import { kovo } from '@kovojs/drizzle';\ndeclare const posture: object;\nkovo({ domain: 'entry', ...posture });\n",
    });

    expect(result.status).toBe('refused');
    expect(result.refusals).toEqual([expect.objectContaining({ category: 'app-context' })]);
  });

  it('refuses retired runtime authorization classifications as SQL semantics', () => {
    const result = analyzeDrizzleApiV1Migration({
      fileName: 'metadata.ts',
      source:
        "import type { KovoRuntimeAuthorizationClassification } from '@kovojs/drizzle';\nexport type Authorization = KovoRuntimeAuthorizationClassification;\n",
    });

    expect(result.status).toBe('refused');
    expect(result.refusals).toEqual([expect.objectContaining({ category: 'sql-semantics' })]);
  });
});
