import { execFileSync, type ExecFileSyncOptionsWithBufferEncoding } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

describe('component state public types', () => {
  it('accepts JSON state through the package surface and rejects non-JSON state', () => {
    const root = mkdtempSync(join(process.cwd(), 'packages/core/.tmp-component-state-types-'));
    try {
      writeFileSync(
        join(root, 'component-state-proof.ts'),
        `
import { component, type JsonValue } from '@kovojs/core';

interface InterfaceState {
  open: boolean;
}

type AliasState = {
  count: number;
};

const InlineState = component({
  state: () => ({ open: false }),
  render: (_queries, state) => (state.open ? null : null),
});

const SatisfiesState = component({
  state: () => ({ open: false }) satisfies JsonValue,
  render: (_queries, state) => (state.open ? null : null),
});

const InterfaceAnnotatedState = component({
  state: (): InterfaceState => ({ open: false }),
  render: (_queries, state) => (state.open ? null : null),
});

const AliasAnnotatedState = component({
  state: (): AliasState => ({ count: 0 }),
  render: (_queries, state) => (state.count > 0 ? null : null),
});

component({
  render: () => null,
  // @ts-expect-error component state must satisfy JsonValue; Date cannot be serialized.
  state: () => ({ now: new Date() }),
});

component({
  render: () => null,
  // @ts-expect-error component state must satisfy JsonValue; Map cannot be serialized.
  state: () => ({ selected: new Map<string, string>() }),
});

void InlineState;
void SatisfiesState;
void InterfaceAnnotatedState;
void AliasAnnotatedState;
`,
        'utf8',
      );
      writeFileSync(
        join(root, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              allowImportingTsExtensions: true,
              exactOptionalPropertyTypes: true,
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              noEmit: true,
              noUncheckedIndexedAccess: true,
              skipLibCheck: true,
              strict: true,
              target: 'ES2024',
              types: ['node'],
            },
            include: ['component-state-proof.ts'],
          },
          null,
          2,
        ),
        'utf8',
      );

      expect(() =>
        execFileSyncWithDiagnostics(resolveBin('tsc'), ['-p', join(root, 'tsconfig.json')], {
          cwd: process.cwd(),
          stdio: 'pipe',
        }),
      ).not.toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
