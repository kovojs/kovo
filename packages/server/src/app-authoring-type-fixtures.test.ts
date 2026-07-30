import { execFileSync, type ExecFileSyncOptionsWithBufferEncoding } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
});
