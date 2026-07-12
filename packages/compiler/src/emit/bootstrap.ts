import {
  compilerCreateSet,
  compilerJsonStringify,
  compilerSetAdd,
  compilerSetHas,
  compilerSha256Hex,
  compilerSnapshotDenseArray,
  compilerStringSlice,
} from '../compiler-security-intrinsics.js';
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
 * Deterministic SHA-256 digest suffix for import-path-derived aliases. Alias uniqueness is still
 * checked before emission; the digest keeps generated local names stable without relying on a
 * small 32-bit hash in compiler output (SPEC.md §5.2).
 */
function importPathDigest(importPath: string): string {
  return compilerStringSlice(compilerSha256Hex(importPath), 0, 16);
}

/**
 * A per-input unique local alias. The hash of the import path keeps it stable/deterministic;
 * the input index disambiguates the (degenerate) case of two inputs sharing an import path,
 * so the emitted module never declares the same lexical binding twice.
 */
function aliasFor(prefix: string, importPath: string, index: number): string {
  return `${prefix}_${index}_${importPathDigest(importPath)}`;
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
  const inputSnapshot = compilerSnapshotDenseArray(inputs, 'Query plan bootstrap inputs');
  const fileName = options.fileName ?? 'generated/app.client.js';
  // Per-input UNIQUE local aliases (SPEC.md §5.2): two components with the same inferred name
  // produce the same `exportName` (`scan/parse.ts` inferComponentName has no path/hash
  // uniqueness). Without an alias the bootstrap would emit two `import { Demo$queryUpdatePlans }
  // ...` lines = a duplicate lexical binding = a hard ES module SyntaxError that kills the
  // entire client bootstrap. Aliasing each import to a path-hashed local keeps it parseable.
  const queryAliases: string[] = [];
  const clockAliases: (string | undefined)[] = [];
  const allAliases: string[] = [];
  for (let index = 0; index < inputSnapshot.length; index += 1) {
    const input = inputSnapshot[index]!;
    const queryAlias = aliasFor('kovoQueryPlans', input.importPath, index);
    queryAliases[queryAliases.length] = queryAlias;
    allAliases[allAliases.length] = queryAlias;
    const clockAlias = input.clockExportName
      ? aliasFor('kovoClockPlans', input.importPath, index)
      : undefined;
    clockAliases[clockAliases.length] = clockAlias;
    if (clockAlias !== undefined) allAliases[allAliases.length] = clockAlias;
  }
  assertUniqueAliases(allAliases);

  const importLines: string[] = [];
  for (let index = 0; index < inputSnapshot.length; index += 1) {
    const input = inputSnapshot[index]!;
    const specifiers = [`${input.exportName} as ${queryAliases[index]}`];
    const clockAlias = clockAliases[index];
    if (input.clockExportName && clockAlias) {
      specifiers[specifiers.length] = `${input.clockExportName} as ${clockAlias}`;
    }
    importLines[importLines.length] =
      `import { ${joinBootstrapStrings(specifiers, ', ')} } from ${bootstrapJsonSource(input.importPath, 'Bootstrap import path')};`;
  }
  const imports = joinBootstrapStrings(importLines, '\n');

  // SPEC.md §4.8/§5.2: a query bound by two components contributes a plan from EACH. Shallow-
  // spreading the plan objects into one map (`{ ...A, ...B }`) lets B's entry clobber A's for a
  // shared query name, silently dropping one component's update coverage. Instead we MERGE per
  // query name into a combined applier that invokes every contributing component's plan.
  const planLines: string[] = [];
  for (let index = 0; index < queryAliases.length; index += 1) {
    planLines[planLines.length] = `  ${queryAliases[index]!},`;
  }
  const planSources =
    planLines.length > 0
      ? joinBootstrapStrings(planLines, '\n')
      : '  // no compiled query update plans';
  const clockLines: string[] = [];
  for (let index = 0; index < clockAliases.length; index += 1) {
    const alias = clockAliases[index];
    if (alias !== undefined) clockLines[clockLines.length] = `  ...${alias},`;
  }
  const clockSpreads = joinBootstrapStrings(clockLines, '\n');

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

function assertUniqueAliases(aliases: readonly string[]): void {
  const seen = compilerCreateSet<string>();
  const snapshot = compilerSnapshotDenseArray(aliases, 'Bootstrap aliases');
  for (let index = 0; index < snapshot.length; index += 1) {
    const alias = snapshot[index]!;
    if (!compilerSetHas(seen, alias)) {
      compilerSetAdd(seen, alias);
      continue;
    }
    throw new Error(`Duplicate generated bootstrap import alias "${alias}" (SPEC.md §5.2).`);
  }
}

function joinBootstrapStrings(values: readonly string[], separator: string): string {
  let output = '';
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) output += separator;
    output += values[index]!;
  }
  return output;
}

function bootstrapJsonSource(value: unknown, label: string): string {
  const source = compilerJsonStringify(value);
  if (source === undefined) throw new TypeError(`${label} must be JSON-serializable.`);
  return source;
}
