import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { analyzeCoreApiV1Migration, runCoreApiV1Migration } from './migrate-core-api-v1.mjs';

describe('core API v1 migration executable', () => {
  it('splits aliased value/type imports and named re-exports by canonical task', () => {
    const source = [
      "import { component, secret as classify, type Secret, hmacSignature, createMemoryStorage, type DiagnosticCode } from '@kovojs/core';",
      "export { routeRef, trustedReveal, type WebhookVerifier } from '@kovojs/core';",
      '',
    ].join('\n');

    const result = analyzeCoreApiV1Migration({ fileName: 'app.ts', source });

    expect(result.status).toBe('rewritten');
    if (result.status !== 'rewritten') return;
    expect(result.source).toBe(
      [
        "import { component } from '@kovojs/core';",
        "import { secret as classify, type Secret } from '@kovojs/core/security';",
        "import { hmacSignature } from '@kovojs/core/webhooks';",
        "import { createMemoryStorage } from '@kovojs/core/storage';",
        "import { type DiagnosticCode } from '@kovojs/core/diagnostics';",
        "export { routeRef } from '@kovojs/core';",
        "export { trustedReveal } from '@kovojs/core/security';",
        "export { type WebhookVerifier } from '@kovojs/core/webhooks';",
        '',
      ].join('\n'),
    );
  });

  it('keeps the whole write batch unchanged when any file is refused', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-core-api-v1-'));
    const rewritePath = path.join(root, 'app.ts');
    const refusalPath = path.join(root, 'registry.ts');
    const rewriteSource =
      "import { component, secret } from '@kovojs/core';\nvoid component;\nvoid secret;\n";
    const refusalSource =
      "import { QueryRegistry } from '@kovojs/core';\nexport type Queries = QueryRegistry;\n";

    try {
      writeFileSync(rewritePath, rewriteSource);
      writeFileSync(refusalPath, refusalSource);
      const result = runCoreApiV1Migration({
        cwd: root,
        mode: 'write',
        sourcePaths: ['app.ts', 'registry.ts'],
      });

      expect(result.summary).toEqual({ refused: 1, rewritten: 1, unchanged: 0 });
      expect(readFileSync(rewritePath, 'utf8')).toBe(rewriteSource);
      expect(readFileSync(refusalPath, 'utf8')).toBe(refusalSource);
      expect(result.files[1]).toMatchObject({
        path: 'registry.ts',
        state: 'refused',
        refusals: [{ category: 'app-context' }],
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('atomically replaces a fully mechanical write batch', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-core-api-v1-'));
    const sourcePath = path.join(root, 'app.ts');

    try {
      writeFileSync(
        sourcePath,
        "import { component, secret } from '@kovojs/core';\nvoid component;\nvoid secret;\n",
      );
      const result = runCoreApiV1Migration({
        cwd: root,
        mode: 'write',
        sourcePaths: ['app.ts'],
      });

      expect(result.summary).toEqual({ refused: 0, rewritten: 1, unchanged: 0 });
      expect(readFileSync(sourcePath, 'utf8')).toBe(
        [
          "import { component } from '@kovojs/core';",
          "import { secret } from '@kovojs/core/security';",
          'void component;',
          'void secret;',
          '',
        ].join('\n'),
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.each([
    ["import core from '@kovojs/core';", 'ambiguous-binding'],
    ["import * as core from '@kovojs/core';", 'ambiguous-binding'],
    ["export * from '@kovojs/core';", 'ambiguous-binding'],
    ["const core = await import('@kovojs/core');", 'dynamic-import'],
    ["const core = require('@kovojs/core');", 'dynamic-import'],
  ])('refuses ambiguous root access: %s', (source, category) => {
    const result = analyzeCoreApiV1Migration({ fileName: 'ambiguous.ts', source });

    expect(result.status).toBe('refused');
    if (result.status !== 'refused') return;
    expect(result.refusals[0]?.category).toBe(category);
  });

  it.each([
    'ComponentDefinitionInput',
    'ComponentMutationFormState',
    'ComponentProps',
    'GetForm',
    'GetFormDescriptor',
    'GetFormInput',
    'GetFormInputHelper',
    'GetFormInputProps',
    'GetFormProps',
    'LinkDescriptor',
  ])('refuses retired inferred authoring helper %s', (symbol) => {
    const result = analyzeCoreApiV1Migration({
      fileName: 'retired-helper.ts',
      source: `import type { ${symbol} } from '@kovojs/core';\n`,
    });

    expect(result).toMatchObject({
      refusals: [{ category: 'app-context' }],
      status: 'refused',
    });
  });

  it('serializes refusal anchors as UTF-8 byte ranges', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-core-api-v1-'));
    const sourcePath = path.join(root, 'registry.ts');
    const source =
      "// π is two bytes\nimport { QueryRegistry } from '@kovojs/core';\nexport type Queries = QueryRegistry;\n";

    try {
      writeFileSync(sourcePath, source);
      const result = runCoreApiV1Migration({
        cwd: root,
        mode: 'check',
        sourcePaths: ['registry.ts'],
      });
      const refusal = result.files[0]?.refusals?.[0];

      expect(refusal?.anchor.start).toBe(
        Buffer.byteLength(source.slice(0, source.indexOf('QueryRegistry'))),
      );
      expect(refusal?.anchor.end).toBe(refusal.anchor.start + Buffer.byteLength('QueryRegistry'));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
