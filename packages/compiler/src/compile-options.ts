import {
  compilerCreateNullRecord,
  compilerDefineOwnDataProperty,
  compilerFreeze,
  compilerOwnDataValue,
  compilerSnapshotJsonValue,
} from './compiler-security-intrinsics.js';
import type {
  CompileComponentOptions,
  InternalCompileComponentOptions,
  ProductionRenderPlanGateOptions,
} from './types.js';

interface CompileComponentProjectFile {
  readonly fileName: string;
  readonly source: string;
}

type CompileOptionsWithProjectFiles = InternalCompileComponentOptions & {
  readonly extraFiles?: readonly CompileComponentProjectFile[];
};

const jsonCompileOptionNames = [
  'packageComponentPrefixes',
  'previousRegistryFacts',
  'queryShapeFacts',
  'queryShapes',
  'registryFacts',
] as const;

/**
 * Pin the complete compile decision carrier before lowering or any asynchronous handoff.
 * SPEC.md §5.2.1 requires every compiler phase to consume one exact input; inherited values,
 * accessors, and caller mutation must not make successive phases observe different source.
 *
 * @internal Exported so compiler runners consume one pinned carrier.
 */
export function snapshotCompileComponentOptions<Options extends CompileComponentOptions>(
  raw: Options,
): Options;
export function snapshotCompileComponentOptions<Options extends InternalCompileComponentOptions>(
  raw: Options,
): Options;
export function snapshotCompileComponentOptions(
  raw: CompileOptionsWithProjectFiles,
): CompileOptionsWithProjectFiles {
  if (typeof raw !== 'object' || raw === null) {
    throw new TypeError('Compiler options must be an object.');
  }

  const snapshot = compilerCreateNullRecord<unknown>();
  compilerDefineOwnDataProperty(snapshot, 'fileName', requiredCompileOptionString(raw, 'fileName'));
  compilerDefineOwnDataProperty(snapshot, 'source', requiredCompileOptionString(raw, 'source'));

  const packagePrefixDiscoveryRoot = compilerOwnDataValue(
    raw,
    'packagePrefixDiscoveryRoot',
    'Compiler options',
  );
  if (packagePrefixDiscoveryRoot !== undefined) {
    if (typeof packagePrefixDiscoveryRoot !== 'string') {
      throw new TypeError('Compiler options.packagePrefixDiscoveryRoot must be a string.');
    }
    compilerDefineOwnDataProperty(
      snapshot,
      'packagePrefixDiscoveryRoot',
      packagePrefixDiscoveryRoot,
    );
  }

  for (let index = 0; index < jsonCompileOptionNames.length; index += 1) {
    const name = jsonCompileOptionNames[index]!;
    const value = compilerOwnDataValue(raw, name, 'Compiler options');
    if (value === undefined) continue;
    compilerDefineOwnDataProperty(
      snapshot,
      name,
      compilerSnapshotJsonValue(value, `Compiler options.${name}`),
    );
  }

  const productionRenderPlanGate = compilerOwnDataValue(
    raw,
    'productionRenderPlanGate',
    'Compiler options',
  );
  if (productionRenderPlanGate !== undefined) {
    compilerDefineOwnDataProperty(
      snapshot,
      'productionRenderPlanGate',
      snapshotProductionRenderPlanGate(productionRenderPlanGate),
    );
  }

  const sourceProvenance = compilerOwnDataValue(raw, 'sourceProvenance', 'Compiler options');
  if (sourceProvenance !== undefined) {
    // The compiler-owned fixpoint token is an identity marker rather than JSON. Preserve the exact
    // own-data value; unrecognized values cannot satisfy the module-private identity check.
    compilerDefineOwnDataProperty(snapshot, 'sourceProvenance', sourceProvenance);
  }

  const extraFiles = compilerOwnDataValue(raw, 'extraFiles', 'Compiler options');
  if (extraFiles !== undefined) {
    compilerDefineOwnDataProperty(
      snapshot,
      'extraFiles',
      compilerSnapshotJsonValue(extraFiles, 'Compiler options.extraFiles'),
    );
  }

  const frozen = compilerFreeze(snapshot);
  if (!isCompleteCompileOptionsSnapshot(frozen)) {
    throw new TypeError('Compiler options snapshot is missing required own-data fields.');
  }
  return frozen;
}

function isCompleteCompileOptionsSnapshot(
  value: Readonly<Record<string, unknown>>,
): value is Readonly<Record<string, unknown>> & CompileOptionsWithProjectFiles {
  return (
    typeof compilerOwnDataValue(value, 'fileName', 'Compiler options snapshot') === 'string' &&
    typeof compilerOwnDataValue(value, 'source', 'Compiler options snapshot') === 'string'
  );
}

function requiredCompileOptionString(
  raw: CompileOptionsWithProjectFiles,
  name: 'fileName' | 'source',
): string {
  const value = compilerOwnDataValue(raw, name, 'Compiler options');
  if (typeof value !== 'string') {
    throw new TypeError(
      `Compiler options.${name} must be an own data property containing a string.`,
    );
  }
  return value;
}

function snapshotProductionRenderPlanGate(value: unknown): ProductionRenderPlanGateOptions {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Compiler options.productionRenderPlanGate must be an object.');
  }
  const previous = compilerOwnDataValue(
    value,
    'previous',
    'Compiler options.productionRenderPlanGate',
  );
  if (typeof previous !== 'object' || previous === null) {
    throw new TypeError(
      'Compiler options.productionRenderPlanGate.previous must be an own data object.',
    );
  }
  const snapshot = compilerCreateNullRecord<unknown>();
  compilerDefineOwnDataProperty(
    snapshot,
    'previous',
    compilerSnapshotJsonValue(previous, 'Compiler options.productionRenderPlanGate.previous'),
  );
  const tokenFn = compilerOwnDataValue(
    value,
    'tokenFn',
    'Compiler options.productionRenderPlanGate',
  );
  if (tokenFn !== undefined) {
    if (typeof tokenFn !== 'function') {
      throw new TypeError('Compiler options.productionRenderPlanGate.tokenFn must be a function.');
    }
    compilerDefineOwnDataProperty(snapshot, 'tokenFn', tokenFn);
  }
  return compilerFreeze(snapshot) as unknown as ProductionRenderPlanGateOptions;
}
