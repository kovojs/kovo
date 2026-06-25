import { describe, expect, it, vi } from 'vitest';
import type { CompileResult } from '@kovojs/compiler/internal';

import { kovoFixtureCompilerPlugin } from './fixture-compiler-plugin.js';

function compileResult(source: string): CompileResult {
  return {
    componentGraphFacts: [],
    clientExports: [],
    cssAssets: [],
    dependencyFootprint: {},
    diagnostics: [],
    files: [],
    handlerExports: [],
    hmrImpact: null,
    loweredSource: source,
    outputContextFacts: [],
    platformSubstitutions: [],
    publishToClientFacts: [],
    queryUpdatePlans: [],
    renderEquivalenceChecks: [],
    updateCoverage: [],
    viewTransitions: [],
  };
}

describe('kovoFixtureCompilerPlugin', () => {
  it('reuses the shared compile cache for repeated fixture transforms', async () => {
    let count = 0;
    const compile = vi.fn(() => compileResult(`export const marker = ${++count};`));
    const plugin = kovoFixtureCompilerPlugin(compile);
    const configResolved = plugin.configResolved as (config: unknown) => void;
    const transform = plugin.transform as (source: string, id: string) => unknown;

    configResolved({ root: '/workspace/app' });

    await expect(
      Promise.resolve(transform('component(', '/workspace/app/src/demo.tsx')),
    ).resolves.toEqual({
      code: 'export const marker = 1;\n',
      map: null,
    });
    await expect(
      Promise.resolve(transform('component(', '/workspace/app/src/demo.tsx')),
    ).resolves.toEqual({
      code: 'export const marker = 1;\n',
      map: null,
    });
    await expect(
      Promise.resolve(
        transform('component({ render: () => null })', '/workspace/app/src/demo.tsx'),
      ),
    ).resolves.toEqual({
      code: 'export const marker = 2;\n',
      map: null,
    });

    expect(compile).toHaveBeenCalledTimes(2);
  });
});
