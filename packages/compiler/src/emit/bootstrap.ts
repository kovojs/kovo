import { compilerIrHeader } from '../ir.js';

export interface QueryPlanBootstrapInput {
  exportName: string;
  importPath: string;
}

export interface QueryPlanBootstrapOptions {
  fileName?: string;
}

export interface BootstrapEmittedFile {
  fileName: string;
  kind: 'client';
  source: string;
}

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
import { applyDeferredStreamResponseToDom, createQueryStore, installJisoLoader } from '@jiso/runtime';
${imports ? `${imports}\n` : ''}
const store = createQueryStore();
const queryPlans = {
${spreads}
};

installJisoLoader({
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

export function applyJisoDeferredStreamResponse(body, options = {}) {
  return applyDeferredStreamResponseToDom({
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
