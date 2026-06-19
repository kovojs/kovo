import { describe, expect, it } from 'vitest';

import { CompileCache, compileComponentCacheKeyInput } from '../packages/compiler/src/internal.js';
import {
  compileComponentModule,
  type CompileComponentOptions,
  type CompileResult,
} from '../packages/compiler/src/index.js';
import { compilerPerfCorpora, type CompilerPerfFile } from './compiler-perf-corpora.js';

describe('compiler cache transparency', () => {
  it('matches fresh compilation over the perf corpus, including after a targeted edit', () => {
    // SPEC.md §5.2 keeps compiler artifacts deterministic; the incremental cache may change
    // latency, not emitted bytes.
    const files = compilerPerfCorpora().flatMap((corpus) => corpus.files);
    const editedFiles = files.map((file, index) =>
      index === 0 ? { ...file, source: file.source.replace('Item <span>', 'Edited <span>') } : file,
    );

    expect(compileWithCache(files)).toEqual(compileFresh(files));
    expect(compileWithCache(editedFiles)).toEqual(compileFresh(editedFiles));
  });
});

function compileFresh(files: readonly CompilerPerfFile[]): unknown[] {
  return files.map((file) => signature(compileComponentModule(compileOptions(file))));
}

function compileWithCache(files: readonly CompilerPerfFile[]): unknown[] {
  const cache = new CompileCache<CompileResult>();

  return files.map((file) => {
    const options = compileOptions(file);
    const result = cache.getOrCreate(compileComponentCacheKeyInput(options), () =>
      compileComponentModule(options),
    );
    if (result instanceof Promise) throw new Error('compileComponentModule should be synchronous');
    return signature(result);
  });
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
