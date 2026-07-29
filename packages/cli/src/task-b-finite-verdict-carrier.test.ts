import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  snapshotBuildCompilerDiagnosticsForTests,
  snapshotBuildCompilerTaskBFiniteVerdictForTests,
} from './commands/build-export.js';
import { snapshotCompileCompilerTaskBFiniteVerdictForTests } from './commands/compile.js';

const files = [
  {
    fileName: 'src/kv449.ts',
    source: `
import { mutation } from '@kovojs/server';
const RawResponse = Response;
export const raw = mutation('raw', {
  handler() { return RawResponse.json({ ok: true }); },
});
`,
  },
  {
    fileName: 'src/kv450.ts',
    source: `
import { createFileSystemStorage } from '@kovojs/core/storage'
import { mutation } from '@kovojs/server';
const storage = createFileSystemStorage({ root: '/srv/kovo-static' });
export const read = mutation('read', {
  async handler(input) {
    await storage.get(input.key);
    return { ok: true };
  },
});
`,
  },
  {
    fileName: 'src/kv452.ts',
    source: `
import { createFileSystemStorage } from '@kovojs/core/storage'
import { endpoint } from '@kovojs/server'
import { publicScopedKey } from '@kovojs/core';
const storage = createFileSystemStorage({ root: '/srv/kovo-derived' });
const documents = {};
export const persist = endpoint('/persist', {
  access: { kind: 'public', reason: 'classifier fixture' },
  async handler(_input, ctx) {
    const rows = await ctx.db.select().from(documents);
    await storage.put(publicScopedKey('unsafe-export'), JSON.stringify(rows));
    return { ok: true };
  },
});
`,
  },
] as const;

const routePageFiles = [
  {
    fileName: 'src/routes.tsx',
    source: `
import { createFileSystemStorage } from '@kovojs/core/storage'
import { respond, route } from '@kovojs/server'
import { type ScopedKey } from '@kovojs/core';
const storage = createFileSystemStorage({ root: '/srv/kovo-static' });
export const report = route('/report', {
  async page(context) {
    await storage.stat(context.params.key);
    await context.signUrl({ key: context.params.key as ScopedKey });
    return respond.storedFile(storage, context.params.key as ScopedKey);
  },
});
`,
  },
] as const;

function expectCompleteRejectedVerdict(verdict: {
  readonly blockingDiagnostics: readonly { readonly code: string }[];
  readonly status: string;
}) {
  expect(verdict.status).toBe('rejected');
  expect(new Set(verdict.blockingDiagnostics.map((diagnostic) => diagnostic.code))).toEqual(
    new Set(['KV449', 'KV450', 'KV452']),
  );
}

function expectRoutePageRejected(value: {
  readonly blockingDiagnostics: readonly { readonly code: string; readonly message: string }[];
  readonly status: string;
}) {
  expect(value.status).toBe('rejected');
  expect(value.blockingDiagnostics).toHaveLength(3);
  expect(value.blockingDiagnostics.every((diagnostic) => diagnostic.code === 'KV450')).toBe(true);
  expect(value.blockingDiagnostics.map((diagnostic) => diagnostic.message)).toEqual(
    expect.arrayContaining([
      expect.stringContaining('storage.stat requires a key derived'),
      expect.stringContaining('context.signUrl requires a key derived'),
      expect.stringContaining('respond.storedFile requires a key derived'),
    ]),
  );
}

describe('TASK B compiler finite-verdict caller carriers', () => {
  it('executes the build caller with the complete finite diagnostic census', () => {
    expectCompleteRejectedVerdict(snapshotBuildCompilerTaskBFiniteVerdictForTests(files));
  });

  it('executes the compile caller with the complete finite diagnostic census', async () => {
    expectCompleteRejectedVerdict(
      await snapshotCompileCompilerTaskBFiniteVerdictForTests(
        files,
        process.cwd(),
        fileURLToPath(import.meta.url),
      ),
    );
  });

  it('retains route-page finite diagnostics in the build verdict and ordinary preflight', () => {
    expectRoutePageRejected(snapshotBuildCompilerTaskBFiniteVerdictForTests(routePageFiles));
    const diagnostics = snapshotBuildCompilerDiagnosticsForTests(routePageFiles);
    expectRoutePageRejected({ blockingDiagnostics: diagnostics, status: 'rejected' });
  });

  it('retains route-page finite diagnostics in the standalone compile verdict', async () => {
    expectRoutePageRejected(
      await snapshotCompileCompilerTaskBFiniteVerdictForTests(
        routePageFiles,
        process.cwd(),
        fileURLToPath(import.meta.url),
      ),
    );
  });

  it('refuses virtual build roots that escape or alias the compiler-owned project', () => {
    expect(() =>
      snapshotBuildCompilerTaskBFiniteVerdictForTests([
        { fileName: '../outside.ts', source: 'export const escaped = true;' },
      ]),
    ).toThrow('escapes its compiler-owned project');
    expect(() =>
      snapshotBuildCompilerTaskBFiniteVerdictForTests([
        { fileName: 'src/first.ts', source: 'export const first = true;' },
        { fileName: 'src/../src/first.ts', source: 'export const second = true;' },
      ]),
    ).toThrow('duplicates src/first.ts');
  });
});
