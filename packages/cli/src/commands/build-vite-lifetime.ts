/* oxlint-disable typescript/unbound-method -- Captured controls are invoked via boot-pinned Reflect.apply. */
import type { EnvironmentModuleGraph, RunnableDevEnvironment } from 'vite-plus';

import {
  buildApply,
  buildMapClear,
  buildMapHas,
  buildMapSize,
  buildObjectKeys,
  buildOwnDataValue,
  buildSecurityArrayAppend,
  buildSetClear,
  buildSetHas,
  buildSetSize,
} from './build-security-intrinsics.js';

const NativeAggregateError = globalThis.AggregateError;
const NativeError = globalThis.Error;
const NativeTypeError = globalThis.TypeError;
const collectionBrandCanary = Symbol('Kovo build-time Vite collection brand canary');

const expectedModuleGraphKeys = [
  'environment',
  'urlToModuleMap',
  'idToModuleMap',
  'etagToModuleMap',
  'fileToModulesMap',
  '_unresolvedUrlToModuleMap',
  '_resolveId',
  '_hasResolveFailedErrorModules',
] as const;

interface BuildTimeViteModuleGraphOwner {
  readonly environment: object;
  readonly environmentName: string;
  readonly graph: EnvironmentModuleGraph;
  readonly invalidateAll: () => void;
  readonly maps: readonly Map<unknown, unknown>[];
  readonly sets: readonly Set<unknown>[];
}

function captureBuildTimeViteModuleGraphOwner(
  environment: object,
  environmentName: string,
): BuildTimeViteModuleGraphOwner {
  const graph = requiredOwnObject(
    environment,
    'moduleGraph',
    `Vite ${environmentName} environment`,
  ) as unknown as EnvironmentModuleGraph;
  assertExactOwnKeys(
    graph as unknown as object,
    expectedModuleGraphKeys,
    `Vite ${environmentName} module graph`,
  );
  if (
    requiredOwnValue(graph as unknown as object, 'environment', 'Vite module graph') !==
    environmentName
  ) {
    throw new NativeTypeError(
      `Kovo build-time Vite lifecycle expected the ${environmentName} module graph owner name.`,
    );
  }
  const invalidateAll = graph.invalidateAll;
  if (typeof invalidateAll !== 'function') {
    throw new NativeTypeError(
      `Kovo build-time Vite lifecycle expected ${environmentName}.moduleGraph.invalidateAll().`,
    );
  }
  const maps = [
    requiredMap(graph as unknown as object, 'urlToModuleMap', environmentName),
    requiredMap(graph as unknown as object, 'idToModuleMap', environmentName),
    requiredMap(graph as unknown as object, 'etagToModuleMap', environmentName),
    requiredMap(graph as unknown as object, 'fileToModulesMap', environmentName),
    requiredMap(graph as unknown as object, '_unresolvedUrlToModuleMap', environmentName),
  ];
  const sets = [
    requiredSet(graph as unknown as object, '_hasResolveFailedErrorModules', environmentName),
  ];
  if (
    typeof requiredOwnValue(graph as unknown as object, '_resolveId', 'Vite module graph') !==
    'function'
  ) {
    throw new NativeTypeError(
      `Kovo build-time Vite lifecycle expected the ${environmentName} module graph resolver.`,
    );
  }
  return { environment, environmentName, graph, invalidateAll, maps, sets };
}

/**
 * A command-scoped single SSR environment. Unlike a Vite dev server, this owns no client graph,
 * HTTP server, websocket, watcher, public-file census, or dependency optimizer. Framework profile
 * modules and the app still share this one runner and graph for their complete lifetime.
 */
export interface BuildTimeViteRunnableLifetime {
  close(): Promise<void>;
  readonly environment: RunnableDevEnvironment;
  ssrLoadModule<T extends Record<string, unknown> = Record<string, unknown>>(
    id: string,
  ): Promise<T>;
}

/**
 * @internal Capture the single runnable SSR graph and its exact teardown/import controls before
 * loading framework profile modules or authored code.
 */
export function captureBuildTimeViteRunnableLifetime(
  environment: RunnableDevEnvironment,
): BuildTimeViteRunnableLifetime {
  if (environment.name !== 'ssr') {
    throw new NativeTypeError('Kovo build-time Vite runner expected the ssr environment.');
  }
  const owner = captureBuildTimeViteModuleGraphOwner(environment, 'ssr');
  const closeEnvironment = environment.close;
  if (typeof closeEnvironment !== 'function') {
    throw new NativeTypeError('Kovo build-time Vite runner expected environment.close().');
  }
  const runner = environment.runner;
  const importModule = runner.import;
  if (typeof importModule !== 'function') {
    throw new NativeTypeError('Kovo build-time Vite runner expected runner.import().');
  }
  let closePromise: Promise<void> | undefined;

  return {
    close() {
      closePromise ??= closeCapturedBuildTimeViteRunnableEnvironment(
        environment,
        closeEnvironment,
        runner,
        importModule,
        owner,
      );
      return closePromise;
    },
    environment,
    ssrLoadModule<T extends Record<string, unknown>>(id: string): Promise<T> {
      assertCapturedRunnableShape(environment, closeEnvironment, runner, importModule, owner);
      return buildApply<Promise<T>>(importModule, runner, [id]);
    },
  };
}

/** @internal Preserve the primary diagnostic while retaining teardown failure evidence. */
export function combineBuildTimeViteFailures(
  primaryError: unknown,
  teardownError: unknown,
): AggregateError {
  return aggregateErrors(
    [primaryError, teardownError],
    primaryErrorMessage(primaryError),
    primaryError,
  );
}

async function closeCapturedBuildTimeViteRunnableEnvironment(
  environment: RunnableDevEnvironment,
  closeEnvironment: () => Promise<void>,
  runner: RunnableDevEnvironment['runner'],
  importModule: RunnableDevEnvironment['runner']['import'],
  owner: BuildTimeViteModuleGraphOwner,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    assertCapturedRunnableShape(environment, closeEnvironment, runner, importModule, owner);
  } catch (error) {
    appendError(errors, error);
  }
  try {
    buildApply(owner.invalidateAll, owner.graph, []);
  } catch (error) {
    appendError(errors, error);
  }
  try {
    await buildApply<Promise<void>>(closeEnvironment, environment, []);
  } catch (error) {
    appendError(errors, error);
  }
  clearCapturedBuildTimeViteModuleGraph(owner, errors);

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw aggregateErrors(errors, 'Kovo build-time Vite runner teardown failed.', errors[0]);
  }
}

function assertCapturedRunnableShape(
  environment: RunnableDevEnvironment,
  closeEnvironment: () => Promise<void>,
  runner: RunnableDevEnvironment['runner'],
  importModule: RunnableDevEnvironment['runner']['import'],
  owner: BuildTimeViteModuleGraphOwner,
): void {
  if (environment.name !== owner.environmentName) {
    throw new NativeError(
      'Kovo build-time Vite runner environment name changed during evaluation.',
    );
  }
  if (environment !== owner.environment) {
    throw new NativeError('Kovo build-time Vite runner environment changed during evaluation.');
  }
  if (environment.moduleGraph !== owner.graph) {
    throw new NativeError('Kovo build-time Vite runner module graph changed during evaluation.');
  }
  if (environment.close !== closeEnvironment) {
    throw new NativeError('Kovo build-time Vite runner close control changed during evaluation.');
  }
  if (environment.runner !== runner || runner.import !== importModule) {
    throw new NativeError('Kovo build-time Vite runner import control changed during evaluation.');
  }
  assertCapturedModuleGraphOwner(owner);
}

function assertCapturedModuleGraphOwner(owner: BuildTimeViteModuleGraphOwner): void {
  if (requiredOwnObject(owner.environment, 'moduleGraph', 'Vite environment') !== owner.graph) {
    throw new NativeError(
      `Kovo build-time Vite ${owner.environmentName} module graph changed during evaluation.`,
    );
  }
  assertExactOwnKeys(
    owner.graph as unknown as object,
    expectedModuleGraphKeys,
    `Vite ${owner.environmentName} module graph`,
  );
  if (owner.graph.invalidateAll !== owner.invalidateAll) {
    throw new NativeError(
      `Kovo build-time Vite ${owner.environmentName} invalidation control changed during evaluation.`,
    );
  }
  const currentMaps = [
    requiredMap(owner.graph as unknown as object, 'urlToModuleMap', owner.environmentName),
    requiredMap(owner.graph as unknown as object, 'idToModuleMap', owner.environmentName),
    requiredMap(owner.graph as unknown as object, 'etagToModuleMap', owner.environmentName),
    requiredMap(owner.graph as unknown as object, 'fileToModulesMap', owner.environmentName),
    requiredMap(
      owner.graph as unknown as object,
      '_unresolvedUrlToModuleMap',
      owner.environmentName,
    ),
  ];
  for (let mapIndex = 0; mapIndex < currentMaps.length; mapIndex += 1) {
    if (currentMaps[mapIndex] !== owner.maps[mapIndex]) {
      throw new NativeError(
        `Kovo build-time Vite ${owner.environmentName} graph map ${mapIndex} changed during evaluation.`,
      );
    }
  }
  if (
    requiredSet(
      owner.graph as unknown as object,
      '_hasResolveFailedErrorModules',
      owner.environmentName,
    ) !== owner.sets[0]
  ) {
    throw new NativeError(
      `Kovo build-time Vite ${owner.environmentName} graph set changed during evaluation.`,
    );
  }
}

function clearCapturedBuildTimeViteModuleGraph(
  owner: BuildTimeViteModuleGraphOwner,
  errors: unknown[],
): void {
  for (let mapIndex = 0; mapIndex < owner.maps.length; mapIndex += 1) {
    const map = owner.maps[mapIndex]!;
    try {
      buildMapClear(map);
      if (buildMapSize(map) !== 0) {
        throw new NativeError(
          `Kovo build-time Vite lifecycle did not empty ${owner.environmentName} graph map ${mapIndex}.`,
        );
      }
    } catch (error) {
      appendError(errors, error);
    }
  }
  for (let setIndex = 0; setIndex < owner.sets.length; setIndex += 1) {
    const set = owner.sets[setIndex]!;
    try {
      buildSetClear(set);
      if (buildSetSize(set) !== 0) {
        throw new NativeError(
          `Kovo build-time Vite lifecycle did not empty ${owner.environmentName} graph set ${setIndex}.`,
        );
      }
    } catch (error) {
      appendError(errors, error);
    }
  }
}

function requiredOwnObject(source: object, key: PropertyKey, label: string): object {
  const value = requiredOwnValue(source, key, label);
  if (typeof value !== 'object' || value === null) {
    throw new NativeTypeError(`Kovo build-time Vite lifecycle expected ${label}.${String(key)}.`);
  }
  return value;
}

function requiredOwnValue(source: object, key: PropertyKey, label: string): unknown {
  const value = buildOwnDataValue(source, key, label);
  if (value === undefined) {
    throw new NativeTypeError(`Kovo build-time Vite lifecycle expected ${label}.${String(key)}.`);
  }
  return value;
}

function requiredMap(
  source: object,
  key: PropertyKey,
  environmentName: string,
): Map<unknown, unknown> {
  const value = requiredOwnValue(source, key, `Vite ${environmentName} module graph`);
  try {
    buildMapHas(value as ReadonlyMap<unknown, unknown>, collectionBrandCanary);
  } catch {
    throw new NativeTypeError(
      `Kovo build-time Vite lifecycle expected ${environmentName}.moduleGraph.${String(key)} to be a Map.`,
    );
  }
  return value as Map<unknown, unknown>;
}

function requiredSet(source: object, key: PropertyKey, environmentName: string): Set<unknown> {
  const value = requiredOwnValue(source, key, `Vite ${environmentName} module graph`);
  try {
    buildSetHas(value as ReadonlySet<unknown>, collectionBrandCanary);
  } catch {
    throw new NativeTypeError(
      `Kovo build-time Vite lifecycle expected ${environmentName}.moduleGraph.${String(key)} to be a Set.`,
    );
  }
  return value as Set<unknown>;
}

function assertExactOwnKeys(value: object, expected: readonly string[], label: string): void {
  const actual = buildObjectKeys(value);
  if (actual.length !== expected.length) {
    throw new NativeTypeError(
      `Kovo build-time Vite lifecycle rejected changed ${label} shape (${actual.length} keys; expected ${expected.length}).`,
    );
  }
  for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex += 1) {
    const expectedKey = expected[expectedIndex]!;
    let found = false;
    for (let actualIndex = 0; actualIndex < actual.length; actualIndex += 1) {
      if (actual[actualIndex] === expectedKey) {
        found = true;
        break;
      }
    }
    if (!found) {
      throw new NativeTypeError(
        `Kovo build-time Vite lifecycle rejected changed ${label} shape (missing ${expectedKey}).`,
      );
    }
  }
}

function appendError(errors: unknown[], error: unknown): void {
  buildSecurityArrayAppend(errors, error, 'Build-time Vite teardown errors');
}

function primaryErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.length > 0) return error;
  if (typeof error !== 'object' || error === null) return 'Kovo build failed.';
  const message = buildOwnDataValue(error, 'message', 'Primary Kovo build error');
  return typeof message === 'string' && message.length > 0 ? message : 'Kovo build failed.';
}

function aggregateErrors(
  errors: readonly unknown[],
  message: string,
  cause: unknown,
): AggregateError {
  let index = 0;
  const iterator = {
    next(): IteratorResult<unknown> {
      if (index >= errors.length) return { done: true, value: undefined };
      const value = errors[index]!;
      index += 1;
      return { done: false, value };
    },
  };
  const iterable = {
    [Symbol.iterator]() {
      return iterator;
    },
  };
  return new NativeAggregateError(iterable, message, { cause });
}
