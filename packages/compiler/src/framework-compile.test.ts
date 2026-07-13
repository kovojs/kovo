import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompileComponentOptions, CompileResult } from './types.js';
import { createEmptyCompileResult } from './types.js';

const { compileComponentModuleMock } = vi.hoisted(() => ({
  compileComponentModuleMock: vi.fn(),
}));

vi.mock('./compile.js', () => ({
  compileComponentModule: compileComponentModuleMock,
}));

import { compileComponentModuleForFramework } from './framework-compile.js';

const tempRoots: string[] = [];

beforeEach(() => {
  compileComponentModuleMock.mockReset();
  compileComponentModuleMock.mockImplementation(
    (options: CompileComponentOptions): CompileResult => ({
      ...createEmptyCompileResult(),
      files: [
        {
          fileName: `${options.fileName}.server.js`,
          kind: 'server',
          source: `${compileComponentModuleMock.mock.calls.length}:${options.source}`,
        },
      ],
    }),
  );
});

afterEach(() => {
  while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { force: true, recursive: true });
});

describe('framework compiler runner (SPEC §2 / §5.2.1 / §6.6)', () => {
  it('compiles every invocation fresh without retaining caller-visible results', async () => {
    const options = {
      fileName: 'src/card.tsx',
      packagePrefixDiscoveryRoot: tempRoot('kovo-compiler-runner-'),
      source: 'export const Card = component({});',
    };

    const first = await compileComponentModuleForFramework(options);
    (first.files[0] as { source: string }).source = 'export const forged = true;';
    const second = await compileComponentModuleForFramework(options);

    expect(compileComponentModuleMock).toHaveBeenCalledTimes(2);
    expect(second.files[0]!.source).toBe(`2:${options.source}`);
  });

  it('does not retain attacker-sized unique compile results for process lifetime', async () => {
    const root = tempRoot('kovo-compiler-runner-bounded-');

    for (let index = 0; index < 300; index += 1) {
      await compileComponentModuleForFramework({
        fileName: `src/card-${index}.tsx`,
        packagePrefixDiscoveryRoot: root,
        source: `export const Card${index} = component({});`,
      });
    }

    expect(compileComponentModuleMock).toHaveBeenCalledTimes(300);
  });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}
