/* oxlint-disable typescript/unbound-method -- Captured controls are invoked via boot-pinned Reflect.apply. */
import type { EnvironmentModuleGraph, ViteDevServer } from 'vite-plus';

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

const expectedEnvironmentNames = ['client', 'ssr'] as const;
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

/**
 * A command-scoped Vite server plus the exact graph owners captured before authored evaluation.
 * The capture is deliberately strict: a Vite Plus upgrade that adds another graph collection must
 * update this owner list instead of silently restoring the unbounded retention bug.
 */
export interface BuildTimeViteServerLifetime {
  close(): Promise<void>;
  readonly server: ViteDevServer;
}

/** @internal Capture the complete throwaway Vite graph lifetime before loading authored modules. */
export function captureBuildTimeViteServerLifetime(
  server: ViteDevServer,
): BuildTimeViteServerLifetime {
  const environments = requiredOwnObject(server, 'environments', 'Vite server');
  assertExactOwnKeys(environments, expectedEnvironmentNames, 'Vite server environments');
  const owners: BuildTimeViteModuleGraphOwner[] = [];

  for (let index = 0; index < expectedEnvironmentNames.length; index += 1) {
    const environmentName = expectedEnvironmentNames[index]!;
    const environment = requiredOwnObject(
      environments,
      environmentName,
      `Vite ${environmentName} environment`,
    );
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
    buildSecurityArrayAppend(
      owners,
      { environment, environmentName, graph, invalidateAll, maps, sets },
      'Build-time Vite graph owners',
    );
  }

  const closeServer = server.close;
  if (typeof closeServer !== 'function') {
    throw new NativeTypeError('Kovo build-time Vite lifecycle expected server.close().');
  }
  let closePromise: Promise<void> | undefined;

  return {
    close() {
      closePromise ??= closeCapturedBuildTimeViteServer(server, environments, closeServer, owners);
      return closePromise;
    },
    server,
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

async function closeCapturedBuildTimeViteServer(
  server: ViteDevServer,
  environments: object,
  closeServer: () => Promise<void>,
  owners: readonly BuildTimeViteModuleGraphOwner[],
): Promise<void> {
  const errors: unknown[] = [];
  try {
    assertCapturedShape(server, environments, closeServer, owners);
  } catch (error) {
    appendError(errors, error);
  }

  // Public invalidation intentionally runs before close so Vite can release transform products
  // through its supported lifecycle. The owner collections are cleared only after close has shut
  // down the module runners; no shared/live graph is touched.
  for (let index = 0; index < owners.length; index += 1) {
    const owner = owners[index]!;
    try {
      buildApply(owner.invalidateAll, owner.graph, []);
    } catch (error) {
      appendError(errors, error);
    }
  }
  try {
    await buildApply<Promise<void>>(closeServer, server, []);
  } catch (error) {
    appendError(errors, error);
  }

  for (let ownerIndex = 0; ownerIndex < owners.length; ownerIndex += 1) {
    const owner = owners[ownerIndex]!;
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

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw aggregateErrors(errors, 'Kovo build-time Vite teardown failed.', errors[0]);
  }
}

function assertCapturedShape(
  server: ViteDevServer,
  environments: object,
  closeServer: () => Promise<void>,
  owners: readonly BuildTimeViteModuleGraphOwner[],
): void {
  if (requiredOwnObject(server, 'environments', 'Vite server') !== environments) {
    throw new NativeError('Kovo build-time Vite server environments changed during evaluation.');
  }
  if (server.close !== closeServer) {
    throw new NativeError('Kovo build-time Vite server close control changed during evaluation.');
  }
  assertExactOwnKeys(environments, expectedEnvironmentNames, 'Vite server environments');
  for (let index = 0; index < owners.length; index += 1) {
    const owner = owners[index]!;
    if (
      requiredOwnObject(environments, owner.environmentName, 'Vite server environments') !==
      owner.environment
    ) {
      throw new NativeError(
        `Kovo build-time Vite ${owner.environmentName} environment changed during evaluation.`,
      );
    }
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
