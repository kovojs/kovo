import { describe, expect, it } from 'vitest';

import { compileComponentModuleForFramework } from '../packages/compiler/src/internal.js';
import {
  compileComponentModule,
  type CompileComponentOptions,
  type CompileResult,
} from '../packages/compiler/src/index.js';
import { compilerPerfCorpora, type CompilerPerfFile } from './compiler-perf-corpora.js';

describe('framework compiler runner transparency', () => {
  it('matches direct fresh compilation over the perf corpus and after a targeted edit', async () => {
    // SPEC.md §5.2 keeps compiler artifacts deterministic. The supported framework runner pins its
    // input carrier but intentionally retains no result state, so it must match a direct fresh
    // compile for both the original corpus and an in-process edit.
    const files = compilerPerfCorpora().flatMap((corpus) => corpus.files);
    const editedFiles = files.map((file, index) =>
      index === 0 ? { ...file, source: file.source.replace('Item <span>', 'Edited <span>') } : file,
    );

    await expect(compileWithFrameworkRunner(files)).resolves.toEqual(compileFresh(files));
    await expect(compileWithFrameworkRunner(editedFiles)).resolves.toEqual(
      compileFresh(editedFiles),
    );
  });
});

function compileFresh(files: readonly CompilerPerfFile[]): unknown[] {
  return files.map((file) => signature(compileComponentModule(compileOptions(file))));
}

async function compileWithFrameworkRunner(files: readonly CompilerPerfFile[]): Promise<unknown[]> {
  return await Promise.all(
    files.map(async (file) =>
      signature(await compileComponentModuleForFramework(compileOptions(file))),
    ),
  );
}

function compileOptions(file: CompilerPerfFile): CompileComponentOptions {
  return {
    fileName: file.fileName,
    ...(file.registryFacts === undefined ? {} : { registryFacts: file.registryFacts }),
    source: file.source,
  };
}

function signature(result: CompileResult): unknown {
  return {
    clientExports: result.clientExports,
    componentGraphFacts: result.componentGraphFacts,
    cssAssets: result.cssAssets,
    dependencyFootprint: result.dependencyFootprint,
    diagnostics: result.diagnostics,
    files: result.files,
    handlerExports: result.handlerExports,
    outputContextFacts: result.outputContextFacts,
    platformSubstitutions: result.platformSubstitutions,
    queryUpdatePlans: result.queryUpdatePlans,
    renderEquivalenceChecks: result.renderEquivalenceChecks,
    updateCoverage: result.updateCoverage,
    viewTransitions: result.viewTransitions,
  };
}
