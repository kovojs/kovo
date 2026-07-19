import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectKvCodes,
  collectPackageSourceCodes,
  collectDiagnosticRegistryCodesFromMarkdown,
  collectSpecDiagnosticRegistryCodes,
} from './diagnostics-ref.mjs';

async function withTempRepo(callback) {
  const root = await mkdtemp(path.join(tmpdir(), 'kovo-diagnostics-ref-'));
  try {
    await callback(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function legacySpecWithDiagnostic(code) {
  return [
    '# Kovo Technical Specification',
    '',
    '### 11.3 Diagnostic codes (registry)',
    '',
    '| Code | Severity | Meaning |',
    '| --- | --- | --- |',
    `| ${code} | error | Legacy registry entry. |`,
    '',
    '### 11.4 The verification surface',
    '',
  ].join('\n');
}

describe('diagnostics registry source', () => {
  it('decodes runtime KV spellings and walks every JS/TS module extension', async () => {
    expect([...collectKvCodes("throw new Error('\\x4bV999')", 'fixture.cts')]).toEqual(['KV999']);

    await withTempRepo(async (root) => {
      const source = path.join(root, 'packages', 'fixture', 'src');
      await mkdir(source, { recursive: true });
      await writeFile(path.join(source, 'one.cts'), "throw new Error('\\x4bV997')");
      await writeFile(path.join(source, 'two.mts'), 'const KV\\u0039\\u0039\\u0038 = true;');
      await writeFile(path.join(source, 'three.cjs'), "throw new Error('KV996')");
      await writeFile(
        path.join(root, 'packages', 'fixture', 'runtime.mts'),
        "throw new Error('KV995')",
      );

      const codes = await collectPackageSourceCodes({ packagesDir: path.join(root, 'packages') });
      expect([...codes].sort()).toEqual(['KV995', 'KV996', 'KV997', 'KV998']);
    });
  });

  it('does not let one ignore comment launder later occurrences of the same code', async () => {
    await withTempRepo(async (root) => {
      const source = path.join(root, 'packages', 'fixture', 'src');
      await mkdir(source, { recursive: true });
      await writeFile(
        path.join(source, 'runtime.ts'),
        [
          '// diagnostics-ref-ignore KV999: intentional fixture token',
          'const fixture = "KV999";',
          'throw new Error("KV999 production diagnostic");',
        ].join('\n'),
      );

      const codes = await collectPackageSourceCodes({ packagesDir: path.join(root, 'packages') });
      expect([...codes]).toEqual(['KV999']);
    });
  });

  it('parses markdown diagnostic table rows with optional code ticks', () => {
    const codes = collectDiagnosticRegistryCodesFromMarkdown(
      [
        '| Code | Severity | Meaning |',
        '| --- | --- | --- |',
        '| KV201 | error | Plain code. |',
        '| `KV210` | lint | Ticked code. |',
      ].join('\n'),
    );

    expect([...codes].sort((a, b) => a.localeCompare(b))).toEqual(['KV201', 'KV210']);
  });

  it('prefers spec/11-diagnostics.md over the legacy root SPEC section', async () => {
    await withTempRepo(async (root) => {
      await writeFile(path.join(root, 'SPEC.md'), legacySpecWithDiagnostic('KV201'));
      await mkdir(path.join(root, 'spec'));
      await writeFile(
        path.join(root, 'spec', '11-diagnostics.md'),
        [
          '# 11.3 Diagnostic codes (registry)',
          '',
          '| Code | Severity | Meaning |',
          '| --- | --- | --- |',
          '| KV210 | lint | Split registry entry. |',
        ].join('\n'),
      );

      const registry = await collectSpecDiagnosticRegistryCodes({ repoRootPath: root });
      expect(registry.label).toBe('spec/11-diagnostics.md');
      expect([...registry.codes]).toEqual(['KV210']);
    });
  });

  it('falls back to SPEC §11.3 while the split module is absent', async () => {
    await withTempRepo(async (root) => {
      await writeFile(path.join(root, 'SPEC.md'), legacySpecWithDiagnostic('KV201'));

      const registry = await collectSpecDiagnosticRegistryCodes({ repoRootPath: root });
      expect(registry.label).toBe('SPEC §11.3 diagnostic table');
      expect([...registry.codes]).toEqual(['KV201']);
    });
  });
});
