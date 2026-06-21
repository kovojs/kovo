import { compilerIrHeader } from '../ir.js';

const RUNTIME_GENERATED_IMPORT = '@kovojs/browser/generated';

/**
 * One compiled query-update-plan module to wire into the app bootstrap: the module's
 * `importPath` and the named `exportName` whose plans get spread into the client loader.
 * Public input shape for emitQueryPlanBootstrapModule (SPEC.md §5.2).
 */
export interface QueryPlanBootstrapInput {
  clockExportName?: string;
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
/**
 * Deterministic 32-bit FNV-1a hash rendered as a fixed-width hex suffix. Used to derive a
 * collision-resistant-enough, stable local alias per import path so two same-named exports
 * (e.g. two `Demo$queryUpdatePlans` from different files) never share a lexical binding.
 */
function importPathHash(importPath: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < importPath.length; index += 1) {
    hash ^= importPath.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * A per-input unique local alias. The hash of the import path keeps it stable/deterministic;
 * the input index disambiguates the (degenerate) case of two inputs sharing an import path,
 * so the emitted module never declares the same lexical binding twice.
 */
function aliasFor(prefix: string, importPath: string, index: number): string {
  return `${prefix}_${index}_${importPathHash(importPath)}`;
}

/**
 * @internal
 * Emit the app client bootstrap module that imports each component's query-update plan and
 * installs the loader. Internal compiler codegen — the emitted artifact is the contract, not
 * this function.
 */
export function emitQueryPlanBootstrapModule(
  inputs: readonly QueryPlanBootstrapInput[],
  options: QueryPlanBootstrapOptions = {},
): BootstrapEmittedFile {
  const fileName = options.fileName ?? 'generated/app.client.js';
  // Per-input UNIQUE local aliases (SPEC.md §5.2): two components with the same inferred name
  // produce the same `exportName` (`scan/parse.ts` inferComponentName has no path/hash
  // uniqueness). Without an alias the bootstrap would emit two `import { Demo$queryUpdatePlans }
  // ...` lines = a duplicate lexical binding = a hard ES module SyntaxError that kills the
  // entire client bootstrap. Aliasing each import to a path-hashed local keeps it parseable.
  const queryAliases = inputs.map((input, index) =>
    aliasFor('kovoQueryPlans', input.importPath, index),
  );
  const clockAliases = inputs.map((input, index) =>
    input.clockExportName ? aliasFor('kovoClockPlans', input.importPath, index) : undefined,
  );

  const imports = inputs
    .map((input, index) => {
      const specifiers = [`${input.exportName} as ${queryAliases[index]}`];
      const clockAlias = clockAliases[index];
      if (input.clockExportName && clockAlias) {
        specifiers.push(`${input.clockExportName} as ${clockAlias}`);
      }
      return `import { ${specifiers.join(', ')} } from ${JSON.stringify(input.importPath)};`;
    })
    .join('\n');

  // SPEC.md §4.8/§5.2: a query bound by two components contributes a plan from EACH. Shallow-
  // spreading the plan objects into one map (`{ ...A, ...B }`) lets B's entry clobber A's for a
  // shared query name, silently dropping one component's update coverage. Instead we MERGE per
  // query name into a combined applier that invokes every contributing component's plan.
  const planSources =
    queryAliases.length > 0
      ? queryAliases.map((alias) => `  ${alias},`).join('\n')
      : '  // no compiled query update plans';
  const clockSpreads = clockAliases
    .filter((alias): alias is string => alias !== undefined)
    .map((alias) => `  ...${alias},`)
    .join('\n');

  return {
    fileName,
    kind: 'client',
    source: `${compilerIrHeader}
import { applyDeferredStreamResponseToRuntime, createQueryStore, installKovoLoader } from '${RUNTIME_GENERATED_IMPORT}';
${imports ? `${imports}\n` : ''}
const store = createQueryStore();
// SPEC.md §4.8: merge same-query-name appliers so a query bound by multiple components keeps
// every component's update plan instead of clobbering all but the last.
function mergeKovoQueryPlans(plans) {
  const merged = {};
  for (const plan of plans) {
    if (!plan) continue;
    for (const name of Object.keys(plan)) {
      const applier = plan[name];
      const existing = merged[name];
      merged[name] = existing
        ? (root, value, context = {}) => {
            existing(root, value, context);
            return applier(root, value, context);
          }
        : applier;
    }
  }
  return merged;
}
const queryPlans = mergeKovoQueryPlans([
${planSources}
]);
const clockUpdatePlans = [
${clockSpreads || '  // no compiled clock update plans'}
];

const loader = installKovoLoader({
  importModule: (specifier) => import(specifier),
  root: document,
  clockUpdatePlans,
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
    // K4 / SPEC §4.7: thread the loader's islandSignalScope so a deferred-stream
    // morph that removes an island correctly aborts its ctx.signal.
    islandSignalScope: loader.islandSignalScope,
    ...(options.morph ? { morph: options.morph } : {}),
    queryPlans,
    root: options.root ?? document,
    store,
  });
}
`,
  };
}
