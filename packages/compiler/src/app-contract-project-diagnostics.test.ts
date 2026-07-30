import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const diagnosticsProbe = vi.hoisted(() => ({ calls: 0 }));

vi.mock('typescript', async (importOriginal) => {
  const original = await importOriginal<typeof import('typescript')>();
  return {
    ...original,
    getPreEmitDiagnostics(...args: Parameters<typeof original.getPreEmitDiagnostics>) {
      diagnosticsProbe.calls += 1;
      return original.getPreEmitDiagnostics(...args);
    },
  };
});

const { createCompilerOwnedAppContractProject } = await import('./app-contract-project.js');

const temporaryDirectories: string[] = [];

afterEach(async () => {
  diagnosticsProbe.calls = 0;
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe('compiler-owned app-contract diagnostic allocation', () => {
  it('keeps ordinary resolver use diagnostic-lazy and computes the exact Program census once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-app-contract-diagnostics-'));
    temporaryDirectories.push(root);
    const entry = join(root, 'entry.ts');
    await writeFile(entry, 'export const invalid: string = 1;\n', 'utf8');

    const project = createCompilerOwnedAppContractProject({ rootNames: [entry] });

    expect(
      project.staticFacts([{ fileName: entry, source: 'export const invalid: string = 1;\n' }]),
    ).toEqual([]);
    expect(diagnosticsProbe.calls).toBe(0);

    expect(project.diagnosticCodesForFile(entry)).toContain(2322);
    expect(diagnosticsProbe.calls).toBe(1);
    expect(project.diagnosticCodesForFile(entry)).toContain(2322);
    expect(diagnosticsProbe.calls).toBe(1);
  });
});
