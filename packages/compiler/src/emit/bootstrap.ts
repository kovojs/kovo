import { compilerIrHeader } from '../ir.js';

/**
 * One compiled query-update-plan module to wire into the app bootstrap: the module's
 * `importPath` and the named `exportName` whose plans get spread into the client loader.
 * Public input shape for emitQueryPlanBootstrapModule (SPEC.md §5.2).
 */
export interface QueryPlanBootstrapInput {
  exportName: string;
  importPath: string;
}

/**
 * Options for emitQueryPlanBootstrapModule; `fileName` overrides the default emitted client
 * bootstrap path (`generated/app.client.js`). Public (SPEC.md §5.2).
 */
export interface QueryPlanBootstrapOptions {
  fileName?: string;
}

export interface BootstrapEmittedFile {
  fileName: string;
  kind: 'client';
  source: string;
}

/**
 * Emit the client bootstrap module that installs the Kovo loader and registers every
 * compiled query update plan, so an app's hydration wiring is generated rather than
 * hand-written. Returns the lowered-IR client file (SPEC.md §5.2).
 *
 * Public build/codegen helper consumed by an app's bootstrap-emit step.
 */
export function emitQueryPlanBootstrapModule(
  inputs: readonly QueryPlanBootstrapInput[],
  options: QueryPlanBootstrapOptions = {},
): BootstrapEmittedFile {
  const fileName = options.fileName ?? 'generated/app.client.js';
  const imports = inputs
    .map((input) => `import { ${input.exportName} } from ${JSON.stringify(input.importPath)};`)
    .join('\n');
  const spreads =
    inputs.length > 0
      ? inputs.map((input) => `  ...${input.exportName},`).join('\n')
      : '  // no compiled query update plans';

  return {
    fileName,
    kind: 'client',
    source: `${compilerIrHeader}
import { applyDeferredStreamResponseToRuntime, createQueryStore, installKovoLoader } from '@kovojs/runtime';
${imports ? `${imports}\n` : ''}
const store = createQueryStore();
const queryPlans = {
${spreads}
};

installKovoLoader({
  importModule: (specifier) => import(specifier),
  root: document,
  queryStore: store,
  enhancedMutations: {
    fetch: (url, options) => fetch(url, options),
    queryPlans,
    root: document,
    store,
  },
});

export function applyKovoDeferredStreamResponse(body, options = {}) {
  return applyDeferredStreamResponseToRuntime({
    body,
    ...(options.boundary ? { boundary: options.boundary } : {}),
    ...(options.morph ? { morph: options.morph } : {}),
    queryPlans,
    root: options.root ?? document,
    store,
  });
}
`,
  };
}
