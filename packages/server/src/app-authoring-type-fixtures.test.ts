import { execFileSync, type ExecFileSyncOptionsWithBufferEncoding } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import ts from 'typescript';

function resolveBin(name: string): string {
  return join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name,
  );
}

function execFileSyncWithDiagnostics(
  file: string,
  args: readonly string[],
  options: ExecFileSyncOptionsWithBufferEncoding,
): void {
  try {
    execFileSync(file, [...args], options);
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString('utf8') ?? '';
    const stdout = (error as { stdout?: Buffer }).stdout?.toString('utf8') ?? '';
    throw new Error([stdout, stderr].filter(Boolean).join('\n'));
  }
}

describe('app-contract public type fixtures', () => {
  it('checks positive inference and every expected unsafe/renamed call shape', () => {
    expect(() =>
      execFileSyncWithDiagnostics(
        resolveBin('tsc'),
        [
          '-p',
          join(process.cwd(), 'packages/server/type-fixtures/app-contract/tsconfig.json'),
          '--incremental',
          'false',
          '--pretty',
          'false',
        ],
        {
          cwd: process.cwd(),
          stdio: 'pipe',
        },
      ),
    ).not.toThrow();
  });

  it('anchors an unknown query property locally within the D1 diagnostic-size budget', () => {
    const fixtureSource = readFileSync(
      join(process.cwd(), 'packages/server/type-fixtures/app-contract/diagnostic-query.ts.fixture'),
      'utf8',
    );
    const fixtureRoot = mkdtempSync(
      join(process.cwd(), 'packages/server/.tmp-app-contract-diagnostic-'),
    );
    const fileName = join(fixtureRoot, 'diagnostic-query.ts');
    writeFileSync(fileName, fixtureSource, 'utf8');
    try {
      const expectedStart = fixtureSource.indexOf('lod');
      const program = ts.createProgram({
        options: {
          allowImportingTsExtensions: true,
          exactOptionalPropertyTypes: true,
          lib: ['lib.es2024.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          noEmit: true,
          noUncheckedIndexedAccess: true,
          skipLibCheck: true,
          strict: true,
          target: ts.ScriptTarget.ES2024,
          types: ['node'],
        },
        rootNames: [fileName],
      });
      const diagnostic = ts
        .getPreEmitDiagnostics(program)
        .find((entry) => entry.file?.fileName === fileName && entry.start === expectedStart);
      const message =
        diagnostic === undefined
          ? ''
          : ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

      expect(diagnostic?.code).toBe(2322);
      expect(diagnostic?.start).toBe(expectedStart);
      expect(diagnostic?.length).toBe(3);
      expect(message).toBe("Type '() => { ok: boolean; }' is not assignable to type 'never'.");
      expect(message.length).toBeLessThanOrEqual(240);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });
});
