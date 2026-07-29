import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { analyzeServerApiV1Migration, runServerApiV1Migration } from './migrate-server-api-v1.mjs';

describe('server API v1 migration executable', () => {
  it('splits retained, task, core, and browser imports without changing aliases', () => {
    const source = [
      "import { mutation, agent as assistant, type AgentSession, runCommand, publicScopedKey, trustedHtml, type Secret } from '@kovojs/server';",
      "export { route, task, type TaskDefinition, redirect } from '@kovojs/server';",
      '',
    ].join('\n');

    const result = analyzeServerApiV1Migration({ fileName: 'app.ts', source });

    expect(result.status).toBe('rewritten');
    if (result.status !== 'rewritten') return;
    expect(result.source).toBe(
      [
        "import { mutation } from '@kovojs/server';",
        "import { agent as assistant, type AgentSession } from '@kovojs/server/agent';",
        "import { runCommand } from '@kovojs/server/command';",
        "import { publicScopedKey } from '@kovojs/core';",
        "import { trustedHtml } from '@kovojs/browser';",
        "import { type Secret } from '@kovojs/core/security';",
        "export { route } from '@kovojs/server';",
        "export { task, type TaskDefinition } from '@kovojs/server/tasks';",
        "export { redirect } from '@kovojs/core';",
        '',
      ].join('\n'),
    );
  });

  it('moves the retired server testing helpers to focused test entrypoints', () => {
    const source = [
      "import { createPostgresTestRuntime, type KovoPostgresTestDb, mutationCsrfTokenForTesting } from '@kovojs/server/testing';",
      "export { type KovoPostgresTestRuntimeOptions } from '@kovojs/server/testing';",
      '',
    ].join('\n');

    const result = analyzeServerApiV1Migration({ fileName: 'app.test.ts', source });

    expect(result.status).toBe('rewritten');
    if (result.status !== 'rewritten') return;
    expect(result.source).toBe(
      [
        "import { createPostgresTestRuntime, type KovoPostgresTestDb } from '@kovojs/test/postgres';",
        "import { mutationCsrfTokenForTesting } from '@kovojs/test/csrf';",
        "export { type KovoPostgresTestRuntimeOptions } from '@kovojs/test/postgres';",
        '',
      ].join('\n'),
    );
  });

  it.each([
    ["import { renderWithRequestForTesting } from '@kovojs/server/testing';", 'app-context'],
    ["import '@kovojs/server/testing';", 'ambiguous-binding'],
    ["import { MutationCsrfDeclaration } from '@kovojs/server';", 'csrf-posture'],
    ["import { KovoSqliteSystemDb } from '@kovojs/server/sqlite';", 'sql-semantics'],
  ])('refuses removed server carriers without guessing: %s', (source, category) => {
    const result = analyzeServerApiV1Migration({ fileName: 'removed.ts', source });

    expect(result.status).toBe('refused');
    if (result.status !== 'refused') return;
    expect(result.refusals[0]?.category).toBe(category);
  });

  it('keeps a write batch unchanged when any file needs application context', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-server-api-v1-'));
    const rewritePath = path.join(root, 'app.ts');
    const refusalPath = path.join(root, 'carrier.ts');
    const rewriteSource =
      "import { mutation, agent } from '@kovojs/server';\nvoid mutation;\nvoid agent;\n";
    const refusalSource =
      "import { isKovoApp } from '@kovojs/server';\nexport const check = isKovoApp;\n";

    try {
      writeFileSync(rewritePath, rewriteSource);
      writeFileSync(refusalPath, refusalSource);
      const result = runServerApiV1Migration({
        cwd: root,
        mode: 'write',
        sourcePaths: ['app.ts', 'carrier.ts'],
      });

      expect(result.summary).toEqual({ refused: 1, rewritten: 1, unchanged: 0 });
      expect(readFileSync(rewritePath, 'utf8')).toBe(rewriteSource);
      expect(readFileSync(refusalPath, 'utf8')).toBe(refusalSource);
      expect(result.files[1]).toMatchObject({
        path: 'carrier.ts',
        state: 'refused',
        refusals: [{ category: 'app-context' }],
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('atomically replaces a fully mechanical write batch', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-server-api-v1-'));
    const sourcePath = path.join(root, 'app.ts');

    try {
      writeFileSync(
        sourcePath,
        "import { mutation, agent } from '@kovojs/server';\nvoid mutation;\nvoid agent;\n",
      );
      const result = runServerApiV1Migration({
        cwd: root,
        mode: 'write',
        sourcePaths: ['app.ts'],
      });

      expect(result.summary).toEqual({ refused: 0, rewritten: 1, unchanged: 0 });
      expect(readFileSync(sourcePath, 'utf8')).toBe(
        [
          "import { mutation } from '@kovojs/server';",
          "import { agent } from '@kovojs/server/agent';",
          'void mutation;',
          'void agent;',
          '',
        ].join('\n'),
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.each([
    ["import server from '@kovojs/server';", 'ambiguous-binding'],
    ["import * as server from '@kovojs/server';", 'ambiguous-binding'],
    ["export * from '@kovojs/server';", 'ambiguous-binding'],
    ["const server = await import('@kovojs/server');", 'dynamic-import'],
    ["const server = require('@kovojs/server');", 'dynamic-import'],
  ])('refuses ambiguous root access: %s', (source, category) => {
    const result = analyzeServerApiV1Migration({ fileName: 'ambiguous.ts', source });

    expect(result.status).toBe('refused');
    if (result.status !== 'refused') return;
    expect(result.refusals[0]?.category).toBe(category);
  });

  it('serializes refusal anchors as UTF-8 byte ranges', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-server-api-v1-'));
    const sourcePath = path.join(root, 'carrier.ts');
    const source =
      "// π is two bytes\nimport { isKovoApp } from '@kovojs/server';\nexport const check = isKovoApp;\n";

    try {
      writeFileSync(sourcePath, source);
      const result = runServerApiV1Migration({
        cwd: root,
        mode: 'check',
        sourcePaths: ['carrier.ts'],
      });
      const refusal = result.files[0]?.refusals?.[0];

      expect(refusal?.anchor.start).toBe(
        Buffer.byteLength(source.slice(0, source.indexOf('isKovoApp'))),
      );
      expect(refusal?.anchor.end).toBe(refusal.anchor.start + Buffer.byteLength('isKovoApp'));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
