// SPEC §10.2/§10.3/§744 (KV422): the SQL-safe managed DB handle. This is the EXISTING SQL-safety
// wrap, extracted out of guards.ts so the framework-owned managed handle (managed-db.ts) can compose
// it with the KV433 read-only proxy without a circular import.
//
// The wrap is the fail-closed runtime floor for KV422: a raw string statement on a managed handle's
// query/exec/execute/sql/prepare entry points throws unless it is a Kovo-branded
// (sql`...`/staticSql`...`/trustedSql(...)) or separated `{ text, values }` carrier. Static AST
// analysis remains the by-construction proof; this is the floor that catches what cannot be proven
// statically (SPEC §6.6: brands/proxies are defense-in-depth, never sold as the proof).

import {
  isDbAdapterLike,
  isPreparedStatementExecutionMethod,
  isSqlHandleLike,
  isSqlHandleProperty,
  snapshotManagedSqlRecipe,
  snapshotManagedSqlStatement,
  sqlSafetyMetadata,
  validateManagedSqlStatement,
  type ManagedSqlStatement,
  type SqlSafetyMode,
} from '@kovojs/core/internal/sql-safety';
import { securityClassifier } from '@kovojs/core/internal/security-markers';
import {
  Column,
  count as drizzleCount,
  Name,
  Param,
  Placeholder,
  SQL,
  StringChunk,
  Table,
} from 'drizzle-orm';
import {
  classifyStatement,
  UNTABLED_SQL_WRITE,
  type ParsedSqlWriteTarget,
  type ParseSqlWriteTablesOptions,
  type SqlClassifierVerdict,
  type SqlWriteTargets,
} from './sql-write-allowlist.js';
import { isSecret } from '@kovojs/core';
import {
  createWitnessMap,
  createWitnessSet,
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessCreateNullRecord,
  witnessCreateWithPrototype,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessGetOwnPropertyDescriptors,
  witnessGetPrototypeOf,
  witnessIsArray,
  witnessObjectKeys,
  witnessOwnKeys,
  witnessReflectApply,
  witnessReflectGet,
  witnessMapGet,
  witnessMapSet,
  witnessSetAdd,
  witnessSetHas,
  witnessSetSize,
  witnessWeakMapDelete,
  witnessWeakMapGet,
  witnessWeakMapSet,
  witnessWeakSetAdd,
  witnessWeakSetDelete,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

const intrinsicObjectPrototype = witnessGetPrototypeOf({});
const nativeSymbolKeyFor = Symbol.keyFor;
const symbolDescriptionDescriptor = witnessGetOwnPropertyDescriptor(
  Symbol.prototype,
  'description',
);
if (
  symbolDescriptionDescriptor === undefined ||
  !('get' in symbolDescriptionDescriptor) ||
  typeof symbolDescriptionDescriptor.get !== 'function'
) {
  throw new TypeError('Kovo managed SQL symbol controls are unavailable.');
}
const nativeSymbolDescription = witnessReflectGet(symbolDescriptionDescriptor, 'get') as Function;
const NativePromise = globalThis.Promise;
const nativePromiseResolve = witnessReflectGet(NativePromise, 'resolve') as Function;
const nativePromiseThen = witnessReflectGet(NativePromise.prototype, 'then') as Function;
const DRIZZLE_TABLE_NAME = Symbol.for('drizzle:Name');
const DRIZZLE_TABLE_SCHEMA = Symbol.for('drizzle:Schema');
const DRIZZLE_TABLE_IS_ALIAS = Symbol.for('drizzle:IsAlias');
const DRIZZLE_TABLE_COLUMNS = Symbol.for('drizzle:Columns');
const DRIZZLE_TABLE_BASE_NAME = Symbol.for('drizzle:BaseName');
const snapshotColumnIdentity = witnessFreeze(
  witnessDefineProperty(
    function (value: unknown): unknown {
      return value;
    },
    'isNoop',
    { value: true },
  ),
);

/** Runtime raw-SQL write table policy enforced on mutation managed DB handles. */
export interface ManagedSqlWritePolicy {
  capability?: 'read' | 'write';
  dialect?: ParseSqlWriteTablesOptions['dialect'];
  engineReadonly?: boolean;
  tables?: readonly string[];
  touches?: readonly string[];
}

declare const managedSqlExecutionPolicyBrand: unique symbol;

/**
 * Framework-owned DB execution policy for the managed SQL choke (SPEC §10.2/§10.3/§11.2, DEC-E).
 * The public shape is intentionally not enough: direct SQL execution wrapping requires a value
 * minted by {@link managedSqlExecutionPolicy}, and the runtime WeakSet check rejects bare casts.
 *
 * @internal
 */
export type ManagedSqlExecutionPolicy = ManagedSqlWritePolicy & {
  readonly [managedSqlExecutionPolicyBrand]: {
    readonly scope: 'framework-managed-sql-execution-policy';
  };
};

export const kovoAsyncMutationTransaction = Symbol('kovo.async-mutation-transaction');

export type AsyncMutationTransactionCapableDb = {
  [kovoAsyncMutationTransaction]?<Result>(
    callback: (transactionDb: unknown) => Promise<Result>,
  ): Promise<Result>;
};

const managedTransactionQueue = createWitnessWeakMap<object, Promise<void>>();
const pinnedSqliteTransactionClients = createWitnessWeakMap<object, SqliteTransactionClient>();
let sqliteSavepointId = 0;

const READ_SQL_BUILDER_FAST_PATH_METHODS = createWitnessSet<PropertyKey>();
for (const method of ['$count', '$with', 'select', 'selectDistinct', 'selectDistinctOn']) {
  witnessSetAdd(READ_SQL_BUILDER_FAST_PATH_METHODS, method);
}
const WRITE_SQL_BUILDER_FAST_PATH_METHODS = createWitnessSet<PropertyKey>();
for (const method of [
  '$count',
  '$with',
  'select',
  'selectDistinct',
  'selectDistinctOn',
  'delete',
  'insert',
  'update',
  'with',
]) {
  witnessSetAdd(WRITE_SQL_BUILDER_FAST_PATH_METHODS, method);
}
const SQL_SNAPSHOT_FAILURE_MESSAGE =
  'KV422: managed SQL statement was validated but could not be snapshotted for execution (SPEC §10.2/§10.3).';
const frameworkManagedDbRawTargets = createWitnessWeakMap<object, object>();
const managedSqlExecutionPolicies = createWitnessWeakSet<object>();
const frameworkCanonicalNativeSqlValues = createWitnessWeakSet<object>();
const relationalManagedSqlTargets = createWitnessWeakSet<object>();
const relationalManagedSqlNamespaces = createWitnessWeakSet<object>();
const frameworkManagedSqlDispatchProxies = createWitnessWeakSet<object>();

/** Create a package-private managed proxy whose framework get trap may be dispatched internally. */
export function createFrameworkManagedSqlDispatchProxy<Target extends object>(
  target: Target,
  handler: ProxyHandler<Target>,
): Target {
  const proxy = new Proxy(target, handler);
  witnessWeakSetAdd(frameworkManagedSqlDispatchProxies, proxy);
  return proxy;
}

/** @internal Whether a managed proxy was constructed by the package-private factory above. */
export function isFrameworkManagedSqlDispatchProxy(value: object): boolean {
  return witnessWeakSetHas(frameworkManagedSqlDispatchProxies, value);
}

/** @internal Dispatch a framework-owned managed proxy's already-hardened get trap. */
export function frameworkManagedSqlDispatchPropertyValue(
  value: object,
  property: PropertyKey,
): unknown {
  if (!witnessWeakSetHas(frameworkManagedSqlDispatchProxies, value)) {
    throw new TypeError('Managed SQL property dispatch requires a framework-owned proxy.');
  }
  return witnessReflectGet(value, property, value);
}

/**
 * Mint the module-private execution policy required by {@link wrapManagedDbForSqlSafety}.
 *
 * @internal
 */
export function managedSqlExecutionPolicy(
  policy: ManagedSqlWritePolicy,
): ManagedSqlExecutionPolicy {
  const minted = witnessFreeze({ ...policy }) as ManagedSqlExecutionPolicy;
  witnessWeakSetAdd(managedSqlExecutionPolicies, minted);
  return minted;
}

/**
 * Resolve the managed-SQL guard mode (SPEC §10.2/§744). The fail-closed default — in every
 * environment, production included — is `enforce`. Fail-open `KOVO_SQL_GUARD=warn/off` migration
 * modes are deliberately ignored for SINK-01: the managed SQL sink is a default-deny runtime floor.
 *
 * @internal
 */
export const managedSqlSafetyMode = securityClassifier(
  'server.sql.managed-safety-mode',
  function (): SqlSafetyMode {
    return 'enforce';
  },
);

/**
 * Wrap a db handle so raw-string SQL on its query/exec/execute/sql/prepare sinks is rejected
 * (KV422, SPEC §10.2). Non-adapter values pass through untouched. Defaults to the
 * {@link managedSqlSafetyMode} when no mode is given so callers (managed-db.ts) get the fail-closed
 * `enforce` floor.
 *
 * @internal
 */
export function wrapManagedDbForSqlSafety<DbValue>(
  db: DbValue,
  mode: SqlSafetyMode = managedSqlSafetyMode(),
  writePolicy?: ManagedSqlExecutionPolicy,
): DbValue {
  if (!isRecord(db)) return db;
  assertManagedSqlExecutionPolicy(writePolicy);
  if (writePolicy === undefined && !isManagedDbAdapterLike(db)) return db;

  const proxyCache = createWitnessWeakMap<object, object>();
  const methodCache = createWitnessWeakMap<object, Map<PropertyKey, Function>>();
  return wrapDbAdapter(
    db,
    mode,
    proxyCache,
    methodCache,
    writePolicy,
    managedSqlRootIsStrict(db, writePolicy),
  ) as DbValue;
}

function assertManagedSqlExecutionPolicy(
  policy: ManagedSqlExecutionPolicy | undefined,
): asserts policy is ManagedSqlExecutionPolicy | undefined {
  if (policy === undefined) return;
  if (
    typeof policy === 'object' &&
    policy !== null &&
    witnessWeakSetHas(managedSqlExecutionPolicies, policy)
  ) {
    return;
  }
  throw new Error(
    'KV422: managed DB SQL execution policy was not created by the framework-owned constructor (SPEC §10.2/§10.3/§11.2). Route DB execution through managedDb()/readonlyDb() so the read/write choke remains the sole door.',
  );
}

/**
 * Resolve the raw target behind a framework-owned managed DB proxy.
 *
 * @internal This is deliberately not exported from the package barrel. Framework subsystems such
 * as durable tasks use it for their own audited internal tables while app-authored code keeps the
 * managed KV422/KV433 surface.
 */
export function frameworkManagedDbRawTarget(value: unknown): object | undefined {
  if (!isRecord(value)) return undefined;
  const target = witnessWeakMapGet(frameworkManagedDbRawTargets, value);
  if (target === undefined) return undefined;
  return frameworkManagedDbRawTarget(target) ?? target;
}

function wrapDbAdapter(
  db: object,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
  writePolicy: ManagedSqlWritePolicy | undefined,
  strictSqlTarget: boolean,
): object {
  const cached = witnessWeakMapGet(proxyCache, db);
  if (cached) return cached;
  if (writePolicy?.capability === 'write') void sqliteTransactionClient(db);

  const proxy = new Proxy(db as Record<PropertyKey, unknown>, {
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    },
    get(target, prop) {
      if (prop === kovoAsyncMutationTransaction) {
        if (writePolicy?.capability === 'read') return undefined;
        const transactionControlTarget = frameworkManagedDbRawTarget(target) ?? target;
        if (!sqliteTransactionClient(transactionControlTarget)) return undefined;
        return <Result>(callback: (transactionDb: unknown) => Promise<Result>) =>
          runSqliteAsyncTransaction(
            transactionControlTarget,
            wrapTransactionDb(transactionControlTarget, mode, proxyCache, methodCache, writePolicy),
            callback,
          );
      }

      if (writePolicy !== undefined && isManagedRawDriverEscapeProperty(prop)) {
        throw new Error(
          `KV422: managed DB raw driver escape ${describeSqlMethod(prop)} is not exposed from framework-owned handles (SPEC §10.2/§10.3). Use the managed SQL methods so statement provenance and declared-table enforcement remain attached.`,
        );
      }

      if (
        writePolicy !== undefined &&
        (prop === 'batch' || prop === 'refreshMaterializedView')
      ) {
        throw new Error(
          `KV422: managed DB method ${describeSqlMethod(prop)} is not exposed because Kovo cannot bind its full statement/table set to the declared SQL policy (SPEC §10.2/§10.3).`,
        );
      }

      const value = managedSqlDataPropertyValue(target, prop);

      if (prop === 'query' && typeof value === 'object' && value !== null) {
        witnessWeakSetAdd(relationalManagedSqlNamespaces, value);
      }

      if (
        witnessWeakSetHas(relationalManagedSqlNamespaces, target) &&
        typeof value === 'object' &&
        value !== null
      ) {
        witnessWeakSetAdd(relationalManagedSqlTargets, value);
      }

      if (isNestedSqlHandleProperty(prop) && typeof value === 'object' && value !== null) {
        return wrapDbAdapter(value, mode, proxyCache, methodCache, writePolicy, true);
      }

      if (
        writePolicy !== undefined &&
        strictSqlTarget &&
        typeof value === 'object' &&
        value !== null
      ) {
        return wrapDbAdapter(
          value,
          mode,
          proxyCache,
          methodCache,
          writePolicy,
          true,
        );
      }

      if (prop === 'sql' && typeof value === 'function' && isManagedDbAdapterLike(target)) {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedSqlMethod(target, value, mode, writePolicy),
        );
      }

      if (
        writePolicy !== undefined &&
        typeof value === 'function' &&
        isRelationalManagedSqlTarget(target) &&
        isRelationalManagedSqlMethod(prop)
      ) {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          (...args: unknown[]) => {
            const callArgs =
              prop === 'findMany' || prop === 'findFirst'
                ? guardedSqlBuilderArguments(args)
                : snapshotDenseSqlMethodArguments(args);
            const result = witnessReflectApply<unknown>(value, target, callArgs);
            if (
              isRecord(result) &&
              (isManagedDbAdapterLike(result) || isSqlHandleLike(result))
            ) {
              witnessWeakSetAdd(relationalManagedSqlTargets, result);
              return wrapDbAdapter(
                result,
                mode,
                proxyCache,
                methodCache,
                writePolicy,
                true,
              );
            }
            return result;
          },
        );
      }

      if (
        isDirectSqlExecutionMethod(prop) &&
        typeof value === 'function' &&
        (isManagedDbAdapterLike(target) || isSqlHandleLike(target))
      ) {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedSqlMethod(target, value, mode, writePolicy),
        );
      }

      if (prop === 'prepare' && typeof value === 'function' && isSqlHandleLike(target)) {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedPrepareMethod(target, value, mode, proxyCache, methodCache, writePolicy),
        );
      }

      if (prop === 'with' && typeof value === 'function' && writePolicy?.capability === 'read') {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedReadWithMethod(target, value, proxyCache, methodCache),
        );
      }

      if (prop === 'with' && typeof value === 'function') {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedWriteWithMethod(target, value, mode, proxyCache, methodCache, writePolicy),
        );
      }

      if (prop === 'transaction' && typeof value === 'function') {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedTransactionMethod(target, value, mode, proxyCache, methodCache, writePolicy),
        );
      }

      if (typeof value !== 'function') return value;
      return cachedSqlSafetyMethod(target, prop, value, methodCache, () => {
        if (isSqlBuilderFastPath(prop, writePolicy)) {
          return guardedSqlBuilderEntry(
            target,
            value,
            proxyCache,
            methodCache,
            isWriteSqlBuilderEntry(prop, writePolicy),
          );
        }
        return guardedUnknownSqlMethod(
          target,
          prop,
          value,
          mode,
          proxyCache,
          methodCache,
          writePolicy,
          strictSqlTarget,
        );
      });
    },
    getOwnPropertyDescriptor(target, prop) {
      return managedSqlProxyDescriptor(target, prop);
    },
    getPrototypeOf() {
      return null;
    },
    ownKeys(target) {
      return managedSqlProxyOwnKeys(target);
    },
    preventExtensions() {
      return false;
    },
    set(target, property, value) {
      return setManagedSqlDataProperty(
        target,
        property,
        value,
        writePolicy,
        strictSqlTarget,
      );
    },
    setPrototypeOf() {
      return false;
    },
  });

  witnessWeakMapSet(proxyCache, db, proxy);
  witnessWeakMapSet(frameworkManagedDbRawTargets, proxy, db);
  return proxy;
}

function managedSqlProxyDescriptor(
  target: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  const descriptor = witnessGetOwnPropertyDescriptor(target, property);
  if (descriptor === undefined || !managedSqlDescriptorCarriesCapability(descriptor)) {
    return descriptor;
  }
  if (descriptor.configurable === false) {
    throw new Error(
      `KV422: managed DB cannot reflect non-configurable authority property ${describeSqlMethod(property)} (SPEC §6.6/§10.3).`,
    );
  }
  return undefined;
}

function managedSqlProxyOwnKeys(target: object): (string | symbol)[] {
  const keys = witnessOwnKeys(target);
  const visible: (string | symbol)[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = witnessGetOwnPropertyDescriptor(keys, index);
    if (key === undefined || !('value' in key)) {
      throw new TypeError('Managed DB reflection keys must remain dense.');
    }
    const descriptor = witnessGetOwnPropertyDescriptor(target, key.value);
    if (
      descriptor !== undefined &&
      descriptor.configurable !== false &&
      managedSqlDescriptorCarriesCapability(descriptor)
    ) {
      continue;
    }
    witnessDefineProperty(visible, visible.length, {
      configurable: true,
      enumerable: true,
      value: key.value,
      writable: true,
    });
  }
  return visible;
}

function managedSqlDescriptorCarriesCapability(descriptor: PropertyDescriptor): boolean {
  return (
    !('value' in descriptor) ||
    (descriptor.value !== null &&
      (typeof descriptor.value === 'object' || typeof descriptor.value === 'function'))
  );
}

function managedSqlDataPropertyValue(target: object, property: PropertyKey): unknown {
  const dispatchTarget = frameworkManagedDbRawTarget(target) ?? target;
  if (witnessWeakSetHas(frameworkManagedSqlDispatchProxies, dispatchTarget)) {
    return witnessReflectGet(dispatchTarget, property, dispatchTarget);
  }
  let owner: object | null = dispatchTarget;
  for (let depth = 0; owner !== null && depth < 64; depth += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      if (!('value' in descriptor)) {
        throw new Error(
          `KV422: managed DB property ${describeSqlMethod(property)} is accessor-backed and cannot be evaluated across the SQL authority boundary (SPEC §6.6/§10.2/§10.3).`,
        );
      }
      return descriptor.value;
    }
    owner = witnessGetPrototypeOf(owner);
  }
  if (owner !== null) {
    throw new Error('KV422: managed DB prototype chain exceeds the bounded authority limit.');
  }
  return undefined;
}

function setManagedSqlDataProperty(
  target: object,
  property: PropertyKey,
  value: unknown,
  writePolicy: ManagedSqlWritePolicy | undefined,
  strictSqlTarget: boolean,
): boolean {
  if (
    strictSqlTarget ||
    writePolicy?.capability !== 'write' ||
    !isManagedSqlPrimitiveState(value)
  ) {
    return false;
  }
  const mutationTarget = frameworkManagedDbRawTarget(target) ?? target;
  const descriptor = witnessGetOwnPropertyDescriptor(mutationTarget, property);
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    descriptor.writable !== true ||
    !isManagedSqlPrimitiveState(descriptor.value)
  ) {
    return false;
  }
  witnessDefineProperty(mutationTarget, property, { ...descriptor, value });
  return true;
}

function isManagedSqlPrimitiveState(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'number' ||
    typeof value === 'string'
  );
}

function isSqlBuilderFastPath(
  prop: PropertyKey,
  writePolicy: ManagedSqlWritePolicy | undefined,
): boolean {
  const methods =
    writePolicy?.capability === 'read'
      ? READ_SQL_BUILDER_FAST_PATH_METHODS
      : WRITE_SQL_BUILDER_FAST_PATH_METHODS;
  return witnessSetHas(methods, prop);
}

function isWriteSqlBuilderEntry(
  prop: PropertyKey,
  writePolicy: ManagedSqlWritePolicy | undefined,
): boolean {
  return writePolicy?.capability !== 'read' && (prop === 'insert' || prop === 'update');
}

function guardedSqlBuilderEntry(
  target: object,
  value: Function,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
  secretWriteBoundary: boolean,
): Function {
  return (...args: unknown[]) => {
    const builder = witnessReflectApply<unknown>(value, target, guardedSqlBuilderArguments(args));
    return isRecord(builder)
      ? wrapSqlBuilderSafety(builder, proxyCache, methodCache, secretWriteBoundary)
      : builder;
  };
}

function wrapSqlBuilderSafety(
  builder: object,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
  secretWriteBoundary: boolean,
): object {
  const cached = witnessWeakMapGet(proxyCache, builder);
  if (cached) return cached;

  const proxy = new Proxy(builder as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = witnessReflectGet(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return cachedSqlSafetyMethod(target, prop, value, methodCache, () => (...args: unknown[]) => {
        if (secretWriteBoundary && (prop === 'values' || prop === 'set')) {
          assertNoSecretDbWriteValue(args);
        }
        const result = witnessReflectApply<unknown>(
          value,
          target,
          guardedSqlBuilderArguments(args),
        );
        return isRecord(result) && !isSqlBuilderTerminalMethod(prop)
          ? wrapSqlBuilderSafety(result, proxyCache, methodCache, secretWriteBoundary)
          : result;
      });
    },
  });
  witnessWeakMapSet(proxyCache, builder, proxy);
  return proxy;
}

function isSqlBuilderTerminalMethod(property: PropertyKey): boolean {
  return (
    property === 'all' ||
    property === 'catch' ||
    property === 'execute' ||
    property === 'finally' ||
    property === 'get' ||
    property === 'run' ||
    property === 'then' ||
    property === 'toSQL' ||
    property === 'values'
  );
}

function guardedSqlBuilderArguments(args: readonly unknown[]): unknown[] {
  const guarded: unknown[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(args, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new Error(
        'KV422: managed SQL builder received a sparse or accessor-backed argument list (SPEC §6.6/§10.2).',
      );
    }
    const argument = descriptor.value;
    if (typeof argument === 'function') {
      appendSqlSafetyValue(guarded, function (this: unknown, ...callbackArgs: unknown[]) {
        const result = witnessReflectApply<unknown>(argument, this, callbackArgs);
        const canonical = canonicalizeNativeDrizzleCountStar(
          snapshotManagedBuilderArgumentGraph(result),
        );
        assertNoUnsafeRawSqlBuilderValue(canonical);
        return canonical;
      });
      continue;
    }
    const canonical = canonicalizeNativeDrizzleCountStar(
      snapshotManagedBuilderArgumentGraph(argument),
    );
    assertNoUnsafeRawSqlBuilderValue(canonical);
    appendSqlSafetyValue(guarded, canonical);
  }
  return guarded;
}

/**
 * Capture each caller descriptor exactly once before any classifier runs. Classifying an object and
 * then rereading it for reconstruction would let a Proxy return a benign graph during the verdict
 * and a different executable graph at the sink. All subsequent classification and reconstruction
 * consumes only this frozen snapshot (SPEC §6.6 C9/C15, §10.2).
 */
function snapshotManagedBuilderArgumentGraph(
  value: unknown,
  seen = createWitnessWeakMap<object, unknown>(),
): unknown {
  if (!isRecord(value)) return value;
  const prior = witnessWeakMapGet(seen, value);
  if (prior !== undefined) return prior;

  const pinnedIdentifier = canonicalPinnedNativeDrizzleIdentifier(value);
  if (pinnedIdentifier !== undefined) {
    witnessWeakMapSet(seen, value, pinnedIdentifier);
    return pinnedIdentifier;
  }

  if (snapshotManagedSqlRecipe(value) !== undefined) {
    const pinned = canonicalPinnedDrizzleSql(value);
    if (pinned === undefined) {
      throw new Error(
        'KV422: sql.raw(...) chunks require trustedSql(..., { justification }) before use in a managed SQL builder (SPEC §6.6/§10.2).',
      );
    }
    witnessWeakMapSet(seen, value, pinned);
    return pinned;
  }

  const prototype = witnessGetPrototypeOf(value);
  const kinds = nativeDrizzleEntityKindsFromPrototype(prototype);
  if (witnessSetSize(kinds) === 0 && plainSqlWrapperSurface(value)) {
    throw new Error(
      'KV422: managed SQL builders reject custom SQLWrapper objects; use Kovo SQL constructors so executable provenance can be snapshotted (SPEC §6.6/§10.2).',
    );
  }
  const structural =
    witnessIsArray(value) ||
    prototype === intrinsicObjectPrototype ||
    prototype === null ||
    witnessSetSize(kinds) > 0;
  if (!structural) {
    return value;
  }

  const descriptors = witnessGetOwnPropertyDescriptors(value);
  if (witnessIsArray(value)) {
    const length = witnessReflectGet(descriptors, 'length') as PropertyDescriptor | undefined;
    if (
      length === undefined ||
      !('value' in length) ||
      typeof length.value !== 'number' ||
      length.value < 0 ||
      length.value % 1 !== 0
    ) {
      throw nativeDrizzleProvenanceError();
    }
    const snapshot: unknown[] = [];
    witnessWeakMapSet(seen, value, snapshot);
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = witnessReflectGet(descriptors, String(index)) as
        | PropertyDescriptor
        | undefined;
      if (descriptor === undefined || !('value' in descriptor)) {
        throw nativeDrizzleProvenanceError();
      }
      witnessDefineProperty(snapshot, index, {
        configurable: true,
        enumerable: true,
        value: snapshotManagedBuilderArgumentGraph(descriptor.value, seen),
        writable: true,
      });
    }
    return witnessFreeze(snapshot);
  }

  const snapshot =
    prototype === intrinsicObjectPrototype || prototype === null
      ? witnessCreateNullRecord()
      : witnessCreateWithPrototype<Record<PropertyKey, unknown>>(prototype);
  witnessWeakMapSet(seen, value, snapshot);
  const keys = witnessOwnKeys(descriptors);
  for (let index = 0; index < keys.length; index += 1) {
    const keyDescriptor = witnessGetOwnPropertyDescriptor(keys, index);
    if (keyDescriptor === undefined || !('value' in keyDescriptor)) {
      throw nativeDrizzleProvenanceError();
    }
    const property = keyDescriptor.value;
    const descriptor = witnessReflectGet(descriptors, property) as PropertyDescriptor | undefined;
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new Error(
        'KV422: managed SQL builder cannot snapshot an accessor-backed argument graph (SPEC §6.6/§10.2).',
      );
    }
    witnessDefineProperty(snapshot, property, {
      configurable: descriptor.configurable ?? false,
      enumerable: descriptor.enumerable ?? false,
      value: snapshotManagedBuilderArgumentGraph(descriptor.value, seen),
      writable: descriptor.writable ?? false,
    });
  }
  return witnessFreeze(snapshot);
}

/**
 * Drizzle's public `count()` helper embeds a module-internal `sql.raw('*')`. Native raw and
 * tagged SQL objects are otherwise intentionally indistinguishable at runtime, so merely
 * allowlisting the inspected input tree would let a Proxy expose safe descriptors during the
 * check and different executable properties later. Reconstruct the one fixed intrinsic instead:
 * the managed builder receives a fresh framework-owned count value and never the caller carrier
 * (SPEC §10.2 C9/C10).
 */
function canonicalizeNativeDrizzleCountStar(
  value: unknown,
  seen = createWitnessWeakMap<object, unknown>(),
): unknown {
  if (!isRecord(value)) return value;
  if (witnessWeakSetHas(frameworkCanonicalNativeSqlValues, value)) return value;
  const prior = witnessWeakMapGet(seen, value);
  if (prior !== undefined) return prior;

  const canonical = canonicalNativeDrizzleCountStar(value);
  if (canonical !== undefined) {
    witnessWeakMapSet(seen, value, canonical);
    return canonical;
  }
  const pinnedSql = canonicalPinnedDrizzleSql(value);
  if (pinnedSql !== undefined) {
    witnessWeakMapSet(seen, value, pinnedSql);
    return pinnedSql;
  }
  const structuredSql = canonicalStructuredNativeDrizzleSql(value);
  if (structuredSql !== undefined) {
    witnessWeakMapSet(seen, value, structuredSql);
    return structuredSql;
  }
  const schemaEntity = canonicalNativeDrizzleSchemaEntity(value, seen);
  if (schemaEntity !== undefined) return schemaEntity;
  if (witnessSetSize(nativeDrizzleEntityKinds(value)) > 0) {
    throw new Error(
      'KV422: unbranded native Drizzle raw SQL/identifier or unsupported entity carriers are not accepted by managed builders; use Kovo SQL constructors (SPEC §6.6/§10.2).',
    );
  }

  if (witnessIsArray(value)) {
    const clone: unknown[] = [];
    witnessWeakMapSet(seen, value, clone);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(value, index);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw nativeDrizzleProvenanceError();
      }
      const item = canonicalizeNativeDrizzleCountStar(descriptor.value, seen);
      appendSqlSafetyValue(clone, item);
    }
    return witnessFreeze(clone);
  }

  let kinds: Set<string>;
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    kinds = nativeDrizzleEntityKinds(value);
    if (witnessSetSize(kinds) > 0) return value;
    prototype = witnessGetPrototypeOf(value);
    if (prototype !== intrinsicObjectPrototype && prototype !== null) return value;
    descriptors = witnessGetOwnPropertyDescriptors(value);
  } catch {
    throw nativeDrizzleProvenanceError();
  }

  const clone =
    prototype === null || prototype === intrinsicObjectPrototype
      ? witnessCreateNullRecord()
      : witnessCreateWithPrototype<Record<PropertyKey, unknown>>(prototype);
  witnessWeakMapSet(seen, value, clone);
  const descriptorKeys = witnessOwnKeys(descriptors);
  for (let keyIndex = 0; keyIndex < descriptorKeys.length; keyIndex += 1) {
    const key = descriptorKeys[keyIndex]!;
    const descriptor = witnessReflectGet(descriptors, key) as PropertyDescriptor | undefined;
    if (!descriptor) continue;
    if (!('value' in descriptor)) {
      throw new Error(
        'KV422: managed SQL builder cannot snapshot an accessor-backed argument container (SPEC §6.6/§10.2).',
      );
    }
    const item = canonicalizeNativeDrizzleCountStar(descriptor.value, seen);
    witnessDefineProperty(clone, key, {
      configurable: descriptor.configurable ?? false,
      enumerable: descriptor.enumerable ?? false,
      value: item,
      writable: descriptor.writable ?? false,
    });
  }
  return witnessFreeze(clone);
}

function canonicalNativeDrizzleSchemaEntity(
  value: object,
  seen: WeakMap<object, unknown>,
): object | undefined {
  const kinds = nativeDrizzleEntityKinds(value);
  if (witnessSetHas(kinds, 'Table')) return reconstructNativeDrizzleTableEntity(value, seen);
  if (witnessSetHas(kinds, 'Column')) return reconstructNativeDrizzleColumnEntity(value, seen);
  return undefined;
}

function reconstructNativeDrizzleTableEntity(
  value: object,
  seen: WeakMap<object, unknown>,
): object {
  const existing = witnessWeakMapGet(seen, value);
  if (isRecord(existing)) return existing;
  const name = requiredOwnString(value, DRIZZLE_TABLE_NAME);
  const schema = optionalOwnString(value, DRIZZLE_TABLE_SCHEMA);
  const baseName = optionalOwnString(value, DRIZZLE_TABLE_BASE_NAME) ?? name;
  const alias = requiredOwnBoolean(value, DRIZZLE_TABLE_IS_ALIAS);
  const columnsDescriptor = witnessGetOwnPropertyDescriptor(value, DRIZZLE_TABLE_COLUMNS);
  if (
    columnsDescriptor === undefined ||
    !('value' in columnsDescriptor) ||
    !isRecord(columnsDescriptor.value)
  ) {
    throw nativeDrizzleProvenanceError();
  }

  const table = new Table(name, schema, baseName);
  witnessWeakMapSet(seen, value, table);
  witnessDefineProperty(table, DRIZZLE_TABLE_IS_ALIAS, { value: alias, writable: false });
  const tableDescriptors = witnessGetOwnPropertyDescriptors(value);
  const tableKeys = witnessOwnKeys(tableDescriptors);
  for (let index = 0; index < tableKeys.length; index += 1) {
    const keyDescriptor = witnessGetOwnPropertyDescriptor(tableKeys, index);
    if (keyDescriptor === undefined || !('value' in keyDescriptor)) {
      throw nativeDrizzleProvenanceError();
    }
    const property = keyDescriptor.value;
    if (
      property === DRIZZLE_TABLE_COLUMNS ||
      property === DRIZZLE_TABLE_NAME ||
      property === DRIZZLE_TABLE_SCHEMA ||
      property === DRIZZLE_TABLE_BASE_NAME ||
      property === DRIZZLE_TABLE_IS_ALIAS ||
      witnessGetOwnPropertyDescriptor(columnsDescriptor.value, property) !== undefined
    ) {
      continue;
    }
    const descriptor = witnessReflectGet(tableDescriptors, property) as
      | PropertyDescriptor
      | undefined;
    if (descriptor === undefined || !('value' in descriptor)) throw nativeDrizzleProvenanceError();
    const copied = canonicalizeNativeDrizzleCountStar(descriptor.value, seen);
    witnessDefineProperty(table, property, {
      configurable: descriptor.configurable ?? false,
      enumerable: descriptor.enumerable ?? false,
      value: copied,
      writable: descriptor.writable ?? false,
    });
  }
  const columns = witnessCreateNullRecord<object>();
  const keys = witnessObjectKeys(columnsDescriptor.value);
  for (let index = 0; index < keys.length; index += 1) {
    const keyDescriptor = witnessGetOwnPropertyDescriptor(keys, index);
    if (keyDescriptor === undefined || !('value' in keyDescriptor)) {
      throw nativeDrizzleProvenanceError();
    }
    const key = keyDescriptor.value;
    const columnDescriptor = witnessGetOwnPropertyDescriptor(columnsDescriptor.value, key);
    if (
      columnDescriptor === undefined ||
      !('value' in columnDescriptor) ||
      !isRecord(columnDescriptor.value) ||
      !witnessSetHas(nativeDrizzleEntityKinds(columnDescriptor.value), 'Column')
    ) {
      throw nativeDrizzleProvenanceError();
    }
    const column = reconstructNativeDrizzleColumnEntity(columnDescriptor.value, seen, table);
    witnessDefineProperty(columns, key, {
      enumerable: true,
      value: column,
    });
    witnessDefineProperty(table, key, {
      enumerable: true,
      value: column,
    });
  }
  witnessDefineProperty(table, DRIZZLE_TABLE_COLUMNS, { value: witnessFreeze(columns) });
  return witnessFreeze(table);
}

function reconstructNativeDrizzleColumnEntity(
  value: object,
  seen: WeakMap<object, unknown>,
  forcedTable?: object,
): object {
  const existing = witnessWeakMapGet(seen, value);
  if (isRecord(existing)) return existing;
  const tableDescriptor = witnessGetOwnPropertyDescriptor(value, 'table');
  if (
    tableDescriptor === undefined ||
    !('value' in tableDescriptor) ||
    !isRecord(tableDescriptor.value)
  ) {
    throw nativeDrizzleProvenanceError();
  }
  const table = forcedTable ?? reconstructNativeDrizzleTableEntity(tableDescriptor.value, seen);
  const column = witnessCreateWithPrototype<Record<PropertyKey, unknown>>(Column.prototype);
  witnessWeakMapSet(seen, value, column);
  const descriptors = witnessGetOwnPropertyDescriptors(value);
  const keys = witnessOwnKeys(descriptors);
  for (let index = 0; index < keys.length; index += 1) {
    const keyDescriptor = witnessGetOwnPropertyDescriptor(keys, index);
    if (keyDescriptor === undefined || !('value' in keyDescriptor)) {
      throw nativeDrizzleProvenanceError();
    }
    const property = keyDescriptor.value;
    if (
      property === 'config' ||
      property === 'table' ||
      property === 'mapFromDriverValue' ||
      property === 'mapToDriverValue'
    ) {
      continue;
    }
    const descriptor = witnessReflectGet(descriptors, property) as PropertyDescriptor | undefined;
    if (descriptor === undefined || !('value' in descriptor)) throw nativeDrizzleProvenanceError();
    const copied = canonicalizeNativeDrizzleCountStar(descriptor.value, seen);
    witnessDefineProperty(column, property, {
      configurable: descriptor.configurable ?? false,
      enumerable: descriptor.enumerable ?? false,
      value: copied,
      writable: descriptor.writable ?? false,
    });
  }
  const configDescriptor = witnessGetOwnPropertyDescriptor(value, 'config');
  if (
    configDescriptor === undefined ||
    !('value' in configDescriptor) ||
    !isRecord(configDescriptor.value)
  ) {
    throw nativeDrizzleProvenanceError();
  }
  const config = canonicalizeNativeDrizzleCountStar(configDescriptor.value, seen);
  if (!isRecord(config)) throw nativeDrizzleProvenanceError();
  witnessDefineProperty(column, 'config', { value: config });
  witnessDefineProperty(column, 'table', { value: table });
  witnessDefineProperty(column, 'mapFromDriverValue', { value: snapshotColumnIdentity });
  witnessDefineProperty(column, 'mapToDriverValue', { value: snapshotColumnIdentity });
  return witnessFreeze(column);
}

function requiredOwnString(value: object, property: PropertyKey): string {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string') {
    throw nativeDrizzleProvenanceError();
  }
  return descriptor.value;
}

function optionalOwnString(value: object, property: PropertyKey): string | undefined {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    (descriptor.value !== undefined && typeof descriptor.value !== 'string')
  ) {
    throw nativeDrizzleProvenanceError();
  }
  return descriptor.value;
}

function requiredOwnBoolean(value: object, property: PropertyKey): boolean {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'boolean') {
    throw nativeDrizzleProvenanceError();
  }
  return descriptor.value;
}

function canonicalPinnedDrizzleSql(value: object): object | undefined {
  const kinds = nativeDrizzleEntityKinds(value);
  if (witnessSetHas(kinds, 'SQL')) {
    if (!validateManagedSqlStatement(value).ok) return undefined;
    const recipe = snapshotManagedSqlRecipe(value);
    if (recipe === undefined) return undefined;
    const chunks: (StringChunk | Param)[] = [];
    for (let index = 0; index < recipe.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(recipe, index);
      if (descriptor === undefined || !('value' in descriptor))
        throw nativeDrizzleProvenanceError();
      const chunk = descriptor.value;
      if (chunk.kind === 'text') {
        const text: string[] = [];
        appendSqlSafetyValue(text, chunk.value);
        const stringChunk = new StringChunk('');
        witnessDefineProperty(stringChunk, 'value', { value: witnessFreeze(text) });
        witnessFreeze(stringChunk);
        appendSqlSafetyValue(chunks, stringChunk);
      } else {
        appendSqlSafetyValue(chunks, witnessFreeze(new Param(chunk.value)));
      }
    }
    const statement = new SQL([]);
    witnessDefineProperty(statement, 'queryChunks', { value: witnessFreeze(chunks) });
    witnessDefineProperty(statement, 'usedTables', { value: witnessFreeze([]) });
    witnessWeakSetAdd(frameworkCanonicalNativeSqlValues, statement);
    return witnessFreeze(statement);
  }

  if (!witnessSetHas(kinds, 'SQL.Aliased')) return undefined;
  const statement = witnessGetOwnPropertyDescriptor(value, 'sql');
  const fieldAlias = witnessGetOwnPropertyDescriptor(value, 'fieldAlias');
  if (
    statement === undefined ||
    !('value' in statement) ||
    !isRecord(statement.value) ||
    fieldAlias === undefined ||
    !('value' in fieldAlias) ||
    typeof fieldAlias.value !== 'string'
  ) {
    throw nativeDrizzleProvenanceError();
  }
  const canonical = canonicalPinnedDrizzleSql(statement.value);
  if (canonical === undefined || !witnessSetHas(nativeDrizzleEntityKinds(canonical), 'SQL')) {
    return undefined;
  }
  const aliased = new SQL.Aliased(canonical as SQL, fieldAlias.value);
  witnessWeakSetAdd(frameworkCanonicalNativeSqlValues, aliased);
  return witnessFreeze(aliased);
}

function canonicalPinnedNativeDrizzleIdentifier(value: object): object | undefined {
  const kinds = nativeDrizzleEntityKinds(value);
  if (!witnessSetHas(kinds, 'Name') || !validateManagedSqlStatement(value).ok) return undefined;
  const descriptor = witnessGetOwnPropertyDescriptor(value, 'value');
  if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string') {
    throw nativeDrizzleProvenanceError();
  }
  const identifier = new Name(descriptor.value);
  witnessWeakSetAdd(frameworkCanonicalNativeSqlValues, identifier);
  return witnessFreeze(identifier);
}

/**
 * Rebuild an accepted unbranded Drizzle expression from its descriptor-only graph. Typed Drizzle
 * predicates such as `eq(column, value)` are ordinary SQL values rather than Kovo-minted recipes,
 * but the caller object still cannot be forwarded after classification: a Proxy may expose benign
 * own descriptors and return different executable `queryChunks` through a later property get.
 * The builder receives only fresh SQL/StringChunk/Param/Name objects constructed from the exact
 * graph that was classified (SPEC §6.6 C9/C15, §10.2).
 */
function canonicalStructuredNativeDrizzleSql(value: object): object | undefined {
  const kinds = nativeDrizzleEntityKinds(value);
  if (!witnessSetHas(kinds, 'SQL') && !witnessSetHas(kinds, 'SQL.Aliased')) return undefined;
  if (nativeDrizzleSqlCarrierVerdict(value) !== 'safe') return undefined;
  return reconstructNativeDrizzleSql(
    value,
    createWitnessWeakMap<object, object>(),
    createWitnessWeakSet<object>(),
  );
}

function reconstructNativeDrizzleSql(
  value: object,
  reconstructed: WeakMap<object, object>,
  active: WeakSet<object>,
): object {
  if (witnessWeakSetHas(active, value)) throw nativeDrizzleProvenanceError();
  const existing = witnessWeakMapGet(reconstructed, value);
  if (existing !== undefined) return existing;
  witnessWeakSetAdd(active, value);
  try {
    const kinds = nativeDrizzleEntityKinds(value);
    if (witnessSetHas(kinds, 'SQL')) {
      const inline = witnessGetOwnPropertyDescriptor(value, 'shouldInlineParams');
      const chunks = witnessGetOwnPropertyDescriptor(value, 'queryChunks');
      if (
        inline === undefined ||
        !('value' in inline) ||
        inline.value !== false ||
        chunks === undefined ||
        !('value' in chunks) ||
        !witnessIsArray(chunks.value)
      ) {
        throw nativeDrizzleProvenanceError();
      }
      const canonicalChunks: unknown[] = [];
      const statement = new SQL([]);
      witnessWeakMapSet(reconstructed, value, statement);
      for (let index = 0; index < chunks.value.length; index += 1) {
        const descriptor = witnessGetOwnPropertyDescriptor(chunks.value, index);
        if (descriptor === undefined || !('value' in descriptor)) {
          throw nativeDrizzleProvenanceError();
        }
        appendSqlSafetyValue(
          canonicalChunks,
          reconstructNativeDrizzleChunk(descriptor.value, reconstructed, active),
        );
      }
      witnessDefineProperty(statement, 'queryChunks', {
        value: witnessFreeze(canonicalChunks),
      });
      witnessDefineProperty(statement, 'usedTables', { value: witnessFreeze([]) });
      witnessWeakSetAdd(frameworkCanonicalNativeSqlValues, statement);
      return witnessFreeze(statement);
    }

    if (!witnessSetHas(kinds, 'SQL.Aliased')) throw nativeDrizzleProvenanceError();
    const sqlDescriptor = witnessGetOwnPropertyDescriptor(value, 'sql');
    const aliasDescriptor = witnessGetOwnPropertyDescriptor(value, 'fieldAlias');
    const originDescriptor = witnessGetOwnPropertyDescriptor(value, 'origin');
    const selectionDescriptor = witnessGetOwnPropertyDescriptor(value, 'isSelectionField');
    if (
      sqlDescriptor === undefined ||
      !('value' in sqlDescriptor) ||
      !isRecord(sqlDescriptor.value) ||
      aliasDescriptor === undefined ||
      !('value' in aliasDescriptor) ||
      typeof aliasDescriptor.value !== 'string' ||
      originDescriptor === undefined ||
      !('value' in originDescriptor) ||
      originDescriptor.value !== undefined ||
      selectionDescriptor === undefined ||
      !('value' in selectionDescriptor) ||
      selectionDescriptor.value !== false
    ) {
      throw nativeDrizzleProvenanceError();
    }
    const canonicalSql = reconstructNativeDrizzleSql(
      sqlDescriptor.value,
      reconstructed,
      active,
    );
    if (!witnessSetHas(nativeDrizzleEntityKinds(canonicalSql), 'SQL')) {
      throw nativeDrizzleProvenanceError();
    }
    const aliased = new SQL.Aliased(canonicalSql as SQL, aliasDescriptor.value);
    witnessWeakMapSet(reconstructed, value, aliased);
    witnessWeakSetAdd(frameworkCanonicalNativeSqlValues, aliased);
    return witnessFreeze(aliased);
  } finally {
    witnessWeakSetDelete(active, value);
  }
}

function reconstructNativeDrizzleChunk(
  value: unknown,
  reconstructed: WeakMap<object, object>,
  active: WeakSet<object>,
): unknown {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return witnessFreeze(new Param(value));
  if (witnessIsArray(value)) {
    if (witnessWeakSetHas(active, value)) throw nativeDrizzleProvenanceError();
    witnessWeakSetAdd(active, value);
    try {
      const items: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = witnessGetOwnPropertyDescriptor(value, index);
        if (descriptor === undefined || !('value' in descriptor)) {
          throw nativeDrizzleProvenanceError();
        }
        appendSqlSafetyValue(
          items,
          reconstructNativeDrizzleChunk(descriptor.value, reconstructed, active),
        );
      }
      return witnessFreeze(items);
    } finally {
      witnessWeakSetDelete(active, value);
    }
  }

  const kinds = nativeDrizzleEntityKinds(value);
  if (witnessSetHas(kinds, 'SQL') || witnessSetHas(kinds, 'SQL.Aliased')) {
    return reconstructNativeDrizzleSql(value, reconstructed, active);
  }
  if (witnessSetHas(kinds, 'StringChunk')) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, 'value');
    if (descriptor === undefined || !('value' in descriptor) || !witnessIsArray(descriptor.value)) {
      throw nativeDrizzleProvenanceError();
    }
    const text: string[] = [];
    for (let index = 0; index < descriptor.value.length; index += 1) {
      const item = witnessGetOwnPropertyDescriptor(descriptor.value, index);
      if (item === undefined || !('value' in item) || typeof item.value !== 'string') {
        throw nativeDrizzleProvenanceError();
      }
      appendSqlSafetyValue(text, item.value);
    }
    const chunk = new StringChunk('');
    witnessDefineProperty(chunk, 'value', { value: witnessFreeze(text) });
    return witnessFreeze(chunk);
  }
  if (witnessSetHas(kinds, 'Param')) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, 'value');
    if (descriptor === undefined || !('value' in descriptor)) throw nativeDrizzleProvenanceError();
    const parameter =
      isRecord(descriptor.value) && witnessSetHas(nativeDrizzleEntityKinds(descriptor.value), 'Placeholder')
        ? reconstructNativeDrizzlePlaceholder(descriptor.value)
        : descriptor.value;
    return witnessFreeze(new Param(parameter));
  }
  if (witnessSetHas(kinds, 'Placeholder')) return reconstructNativeDrizzlePlaceholder(value);
  if (witnessSetHas(kinds, 'Column')) return reconstructNativeDrizzleColumn(value);
  if (witnessSetHas(kinds, 'Table')) return reconstructNativeDrizzleTable(value);
  throw nativeDrizzleProvenanceError();
}

function reconstructNativeDrizzlePlaceholder(value: object): Placeholder {
  const descriptor = witnessGetOwnPropertyDescriptor(value, 'name');
  if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string') {
    throw nativeDrizzleProvenanceError();
  }
  return witnessFreeze(new Placeholder(descriptor.value));
}

function reconstructNativeDrizzleColumn(value: object): object {
  const name = witnessGetOwnPropertyDescriptor(value, 'name');
  const table = witnessGetOwnPropertyDescriptor(value, 'table');
  const isAlias = witnessGetOwnPropertyDescriptor(value, 'isAlias');
  if (
    name === undefined ||
    !('value' in name) ||
    typeof name.value !== 'string' ||
    table === undefined ||
    !('value' in table) ||
    !isRecord(table.value) ||
    isAlias === undefined ||
    !('value' in isAlias) ||
    typeof isAlias.value !== 'boolean'
  ) {
    throw nativeDrizzleProvenanceError();
  }
  if (isAlias.value) return frozenIdentifierSql([name.value]);
  const owner = nativeDrizzleTableIdentifierParts(table.value);
  const parts: string[] = [];
  for (let index = 0; index < owner.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(owner, index);
    if (descriptor === undefined || !('value' in descriptor)) throw nativeDrizzleProvenanceError();
    appendSqlSafetyValue(parts, descriptor.value);
  }
  appendSqlSafetyValue(parts, name.value);
  return frozenIdentifierSql(parts);
}

function reconstructNativeDrizzleTable(value: object): object {
  return frozenIdentifierSql(nativeDrizzleTableIdentifierParts(value));
}

function nativeDrizzleTableIdentifierParts(value: object): readonly string[] {
  const name = witnessGetOwnPropertyDescriptor(value, DRIZZLE_TABLE_NAME);
  const schema = witnessGetOwnPropertyDescriptor(value, DRIZZLE_TABLE_SCHEMA);
  const isAlias = witnessGetOwnPropertyDescriptor(value, DRIZZLE_TABLE_IS_ALIAS);
  if (
    name === undefined ||
    !('value' in name) ||
    typeof name.value !== 'string' ||
    schema === undefined ||
    !('value' in schema) ||
    (schema.value !== undefined && typeof schema.value !== 'string') ||
    isAlias === undefined ||
    !('value' in isAlias) ||
    typeof isAlias.value !== 'boolean'
  ) {
    throw nativeDrizzleProvenanceError();
  }
  return typeof schema.value === 'string' && !isAlias.value
    ? witnessFreeze([schema.value, name.value])
    : witnessFreeze([name.value]);
}

function frozenIdentifierSql(parts: readonly string[]): object {
  const chunks: unknown[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(parts, index);
    if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string') {
      throw nativeDrizzleProvenanceError();
    }
    if (index > 0) appendSqlSafetyValue(chunks, witnessFreeze(new StringChunk('.')));
    appendSqlSafetyValue(chunks, witnessFreeze(new Name(descriptor.value)));
  }
  const statement = new SQL([]);
  witnessDefineProperty(statement, 'queryChunks', { value: witnessFreeze(chunks) });
  witnessDefineProperty(statement, 'usedTables', { value: witnessFreeze([]) });
  witnessWeakSetAdd(frameworkCanonicalNativeSqlValues, statement);
  return witnessFreeze(statement);
}

function canonicalNativeDrizzleCountStar(value: object): object | undefined {
  try {
    const kinds = nativeDrizzleEntityKinds(value);
    if (witnessSetHas(kinds, 'SQL')) {
      const chunks = witnessGetOwnPropertyDescriptor(value, 'queryChunks');
      if (
        chunks !== undefined &&
        'value' in chunks &&
        witnessIsArray(chunks.value) &&
        isNativeDrizzleCountStarIntrinsic(chunks.value)
      ) {
        return registerFrameworkCanonicalNativeSql(drizzleCount());
      }
      return undefined;
    }

    if (!witnessSetHas(kinds, 'SQL.Aliased')) return undefined;
    const descriptors = witnessGetOwnPropertyDescriptors(value);
    const statement = witnessReflectGet(descriptors, 'sql') as PropertyDescriptor | undefined;
    const fieldAlias = witnessReflectGet(descriptors, 'fieldAlias') as
      | PropertyDescriptor
      | undefined;
    const origin = witnessReflectGet(descriptors, 'origin') as PropertyDescriptor | undefined;
    const selection = witnessReflectGet(descriptors, 'isSelectionField') as
      | PropertyDescriptor
      | undefined;
    if (
      !statement ||
      !('value' in statement) ||
      !isRecord(statement.value) ||
      !fieldAlias ||
      !('value' in fieldAlias) ||
      typeof fieldAlias.value !== 'string' ||
      !origin ||
      !('value' in origin) ||
      origin.value !== undefined ||
      !selection ||
      !('value' in selection) ||
      selection.value !== false
    ) {
      return undefined;
    }
    const chunks = witnessGetOwnPropertyDescriptor(statement.value, 'queryChunks');
    if (
      !chunks ||
      !('value' in chunks) ||
      !witnessIsArray(chunks.value) ||
      !isNativeDrizzleCountStarIntrinsic(chunks.value)
    ) {
      return undefined;
    }
    return registerFrameworkCanonicalNativeSql(drizzleCount().as(fieldAlias.value));
  } catch {
    throw nativeDrizzleProvenanceError();
  }
}

function registerFrameworkCanonicalNativeSql<T extends object>(value: T): T {
  freezeFrameworkCanonicalNativeSql(value, createWitnessWeakSet<object>());
  witnessWeakSetAdd(frameworkCanonicalNativeSqlValues, value);
  return value;
}

function freezeFrameworkCanonicalNativeSql(value: object, seen: WeakSet<object>): void {
  if (witnessWeakSetHas(seen, value)) return;
  witnessWeakSetAdd(seen, value);
  const descriptors = witnessGetOwnPropertyDescriptors(value);
  const keys = witnessOwnKeys(descriptors);
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const descriptor = witnessReflectGet(descriptors, keys[keyIndex]!) as
      | PropertyDescriptor
      | undefined;
    if (!descriptor || !('value' in descriptor)) continue;
    if (witnessIsArray(descriptor.value)) {
      for (let index = 0; index < descriptor.value.length; index += 1) {
        const item = witnessGetOwnPropertyDescriptor(descriptor.value, index);
        if (item !== undefined && 'value' in item && isRecord(item.value)) {
          freezeFrameworkCanonicalNativeSql(item.value, seen);
        }
      }
      witnessFreeze(descriptor.value);
    } else if (isRecord(descriptor.value)) {
      freezeFrameworkCanonicalNativeSql(descriptor.value, seen);
    }
  }
  witnessFreeze(value);
}

/**
 * Defense-in-depth for Drizzle builder fast paths (SPEC §6.6/§10.2, KV422). Direct execution
 * already validates the final statement; builders previously bypassed that choke entirely. Walk
 * caller-owned projection/where/order objects without invoking accessors and reject any Kovo
 * `sql.raw(...)` fragment unless `trustedSql(...)` minted the accepted carrier.
 */
function assertNoUnsafeRawSqlBuilderValue(
  value: unknown,
  seen = createWitnessWeakSet<object>(),
): void {
  if (!isRecord(value)) return;
  if (witnessWeakSetHas(seen, value)) return;
  witnessWeakSetAdd(seen, value);
  if (witnessWeakSetHas(frameworkCanonicalNativeSqlValues, value)) return;

  let metadata: ReturnType<typeof sqlSafetyMetadata>;
  try {
    metadata = sqlSafetyMetadata(value);
  } catch {
    throw new Error(
      'KV422: managed SQL builder received a carrier whose raw-SQL provenance could not be inspected (SPEC §6.6/§10.2).',
    );
  }
  if (metadata.containsRawChunk) {
    const validation = validateManagedSqlStatement(value);
    if (!validation.ok) throw new Error(`KV422: ${validation.message}`);
    return;
  }

  // Native Drizzle SQL/Name carriers have non-plain prototypes. Previously that made the walk
  // return below before it could distinguish a Kovo-minted parameterized/static/identifier value
  // from an unbranded `drizzle-orm` sql.raw/sql.identifier value. The two raw/tag shapes are
  // intentionally indistinguishable at runtime, so recognized native carriers must carry Kovo's
  // module-private statement witness; app code uses @kovojs/drizzle sql/staticSql/trustedSql.
  const nativeDrizzleVerdict = nativeDrizzleSqlCarrierVerdict(value);
  if (nativeDrizzleVerdict !== undefined) {
    if (nativeDrizzleVerdict !== 'safe') {
      throw new Error(
        'KV422: unbranded native Drizzle raw SQL/identifier carriers are not accepted by managed builders; use @kovojs/drizzle sql/staticSql/sql.identifier/trustedSql (SPEC §6.6/§10.2).',
      );
    }
    return;
  }

  if (witnessIsArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(value, index);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new Error(
          'KV422: managed SQL builder received a sparse or accessor-backed SQL carrier (SPEC §6.6/§10.2).',
        );
      }
      assertNoUnsafeRawSqlBuilderValue(descriptor.value, seen);
    }
    return;
  }

  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = witnessGetPrototypeOf(value);
    if (prototype !== intrinsicObjectPrototype && prototype !== null) return;
    descriptors = witnessGetOwnPropertyDescriptors(value);
  } catch {
    throw new Error(
      'KV422: managed SQL builder received a carrier whose nested SQL provenance could not be inspected (SPEC §6.6/§10.2).',
    );
  }
  const keys = witnessOwnKeys(descriptors);
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const descriptor = witnessReflectGet(descriptors, keys[keyIndex]!) as
      | PropertyDescriptor
      | undefined;
    if (descriptor && 'value' in descriptor) {
      assertNoUnsafeRawSqlBuilderValue(descriptor.value, seen);
    }
  }
}

type NativeDrizzleSqlCarrierVerdict = 'safe' | 'string-chunk' | 'unsafe';

function nativeDrizzleSqlCarrierVerdict(
  value: object,
  seen = createWitnessWeakSet<object>(),
): NativeDrizzleSqlCarrierVerdict | undefined {
  try {
    if (witnessWeakSetHas(seen, value)) return 'safe';
    witnessWeakSetAdd(seen, value);
    const kinds = nativeDrizzleEntityKinds(value);
    if (witnessSetSize(kinds) === 0) return undefined;

    if (witnessSetHas(kinds, 'SQL')) {
      const frameworkWitness = validateManagedSqlStatement(value).ok;
      const chunks = witnessGetOwnPropertyDescriptor(value, 'queryChunks');
      if (!chunks || !('value' in chunks) || !witnessIsArray(chunks.value)) return 'unsafe';
      let structured = false;
      for (let index = 0; index < chunks.value.length; index += 1) {
        const chunkDescriptor = witnessGetOwnPropertyDescriptor(chunks.value, index);
        if (chunkDescriptor === undefined || !('value' in chunkDescriptor)) return 'unsafe';
        const chunk = chunkDescriptor.value;
        if (typeof chunk !== 'object' || chunk === null) {
          // Drizzle turns primitive interpolations into bound parameters while rendering.
          structured = true;
          continue;
        }
        const verdict = nativeDrizzleSqlCarrierVerdict(chunk, seen);
        if (verdict === 'unsafe') return 'unsafe';
        if (verdict === 'safe') structured = true;
        if (verdict === undefined) {
          const prototype = witnessGetPrototypeOf(chunk);
          if (prototype === intrinsicObjectPrototype || prototype === null) {
            if (plainSqlWrapperSurface(chunk)) return 'unsafe';
            structured = true;
          } else return 'unsafe';
        }
      }
      return frameworkWitness || structured ? 'safe' : 'unsafe';
    }

    if (witnessSetHas(kinds, 'Name')) {
      return validateManagedSqlStatement(value).ok ? 'safe' : 'unsafe';
    }

    if (witnessSetHas(kinds, 'StringChunk')) return 'string-chunk';
    if (
      witnessSetHas(kinds, 'Param') ||
      witnessSetHas(kinds, 'Placeholder') ||
      witnessSetHas(kinds, 'Column') ||
      witnessSetHas(kinds, 'Table')
    ) {
      return 'safe';
    }
    if (witnessSetHas(kinds, 'View') || witnessSetHas(kinds, 'Subquery')) return 'unsafe';

    // SQL.Aliased and future Drizzle wrappers remain closed by inspecting their own data fields
    // without invoking accessors. This prevents a new non-plain wrapper from restoring the former
    // prototype early-return around a nested raw SQL/Name carrier.
    const descriptors = witnessGetOwnPropertyDescriptors(value);
    let foundSql = false;
    let foundStringChunk = false;
    const keys = witnessOwnKeys(descriptors);
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const descriptor = witnessReflectGet(descriptors, keys[keyIndex]!) as
        | PropertyDescriptor
        | undefined;
      if (!descriptor || !('value' in descriptor)) continue;
      const items = witnessIsArray(descriptor.value) ? descriptor.value : [descriptor.value];
      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const itemDescriptor = witnessGetOwnPropertyDescriptor(items, itemIndex);
        if (itemDescriptor === undefined || !('value' in itemDescriptor)) return 'unsafe';
        const item = itemDescriptor.value;
        if (typeof item !== 'object' || item === null) continue;
        const verdict = nativeDrizzleSqlCarrierVerdict(item, seen);
        if (verdict === 'unsafe') return 'unsafe';
        if (verdict === 'safe') foundSql = true;
        if (verdict === 'string-chunk') foundStringChunk = true;
      }
    }
    if (foundStringChunk) return 'unsafe';
    return foundSql ? 'safe' : undefined;
  } catch {
    throw nativeDrizzleProvenanceError();
  }
}

function isNativeDrizzleCountStarIntrinsic(chunks: readonly unknown[]): boolean {
  return (
    chunks.length === 3 &&
    nativeDrizzleStringChunkEquals(chunks[0], 'count(') &&
    nativeDrizzleRawSqlEquals(chunks[1], '*') &&
    nativeDrizzleStringChunkEquals(chunks[2], ')')
  );
}

function nativeDrizzleRawSqlEquals(value: unknown, text: string): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (!witnessSetHas(nativeDrizzleEntityKinds(value), 'SQL')) return false;
  const chunks = witnessGetOwnPropertyDescriptor(value, 'queryChunks');
  return (
    chunks !== undefined &&
    'value' in chunks &&
    witnessIsArray(chunks.value) &&
    chunks.value.length === 1 &&
    nativeDrizzleStringChunkEquals(chunks.value[0], text)
  );
}

function nativeDrizzleStringChunkEquals(value: unknown, text: string): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (!witnessSetHas(nativeDrizzleEntityKinds(value), 'StringChunk')) return false;
  const chunk = witnessGetOwnPropertyDescriptor(value, 'value');
  return (
    chunk !== undefined &&
    'value' in chunk &&
    witnessIsArray(chunk.value) &&
    chunk.value.length === 1 &&
    chunk.value[0] === text
  );
}

function nativeDrizzleProvenanceError(): Error {
  return new Error(
    'KV422: managed SQL builder received a carrier whose native Drizzle provenance could not be inspected (SPEC §6.6/§10.2).',
  );
}

function plainSqlWrapperSurface(value: object): boolean {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = witnessGetOwnPropertyDescriptor(current, 'getSQL');
    if (descriptor !== undefined) {
      return !('value' in descriptor) || typeof descriptor.value === 'function';
    }
    current = witnessGetPrototypeOf(current);
    if (current === intrinsicObjectPrototype) break;
  }
  return false;
}

function nativeDrizzleEntityKinds(value: object): Set<string> {
  return nativeDrizzleEntityKindsFromPrototype(witnessGetPrototypeOf(value));
}

function nativeDrizzleEntityKindsFromPrototype(prototype: object | null): Set<string> {
  const kinds = createWitnessSet<string>();
  while (prototype !== null && prototype !== intrinsicObjectPrototype) {
    const constructor = witnessGetOwnPropertyDescriptor(prototype, 'constructor');
    if (constructor && 'value' in constructor && typeof constructor.value === 'function') {
      const descriptors = witnessGetOwnPropertyDescriptors(constructor.value as object);
      const keys = witnessOwnKeys(descriptors);
      for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        const key = keys[keyIndex]!;
        if (typeof key !== 'symbol' || intrinsicSymbolName(key) !== 'drizzle:entityKind') {
          continue;
        }
        const descriptor = witnessReflectGet(descriptors, key) as PropertyDescriptor | undefined;
        if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string') {
          witnessSetAdd(kinds, descriptor.value);
        }
      }
    }
    prototype = witnessGetPrototypeOf(prototype);
  }
  return kinds;
}

function intrinsicSymbolName(value: symbol): string | undefined {
  const registered = witnessReflectApply<unknown>(nativeSymbolKeyFor, Symbol, [value]);
  if (registered !== undefined && typeof registered !== 'string') {
    throw new TypeError('Kovo managed SQL received an invalid registered symbol name.');
  }
  if (typeof registered === 'string') return registered;
  const description = witnessReflectApply<unknown>(nativeSymbolDescription, value, []);
  if (description !== undefined && typeof description !== 'string') {
    throw new TypeError('Kovo managed SQL received an invalid symbol description.');
  }
  return description as string | undefined;
}

function guardedSqlMethod(
  target: object,
  value: Function,
  mode: SqlSafetyMode,
  writePolicy: ManagedSqlWritePolicy | undefined,
): Function {
  return (statement: unknown, ...args: unknown[]) => {
    const snapshot = enforceManagedSql(statement, mode, writePolicy);
    return wrapReadonlyEngineResult(
      () => witnessReflectApply(value, target, prependSqlSafetyArgument(snapshot, args)),
      writePolicy,
    );
  };
}

function guardedReadWithMethod(
  target: object,
  value: Function,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
): Function {
  return (...args: unknown[]) => {
    const builder = witnessReflectApply<unknown>(value, target, args);
    return isRecord(builder) ? wrapReadWithBuilder(builder, proxyCache, methodCache) : builder;
  };
}

function guardedWriteWithMethod(
  target: object,
  value: Function,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
  writePolicy: ManagedSqlWritePolicy | undefined,
): Function {
  return (...args: unknown[]) => {
    const builder = witnessReflectApply<unknown>(value, target, args);
    return isRecord(builder)
      ? wrapDbAdapter(
          builder,
          mode,
          proxyCache,
          methodCache,
          writePolicy,
          writePolicy !== undefined,
        )
      : builder;
  };
}

function wrapReadWithBuilder(
  builder: object,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
): object {
  const cached = witnessWeakMapGet(proxyCache, builder);
  if (cached) return cached;

  const proxy = new Proxy(builder as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      if (prop === 'then') return undefined;
      if (typeof prop === 'string' && !witnessSetHas(READ_SQL_BUILDER_FAST_PATH_METHODS, prop)) {
        return () => {
          throw new Error(
            `KV433: read-only SQL capability cannot access db.with(...).${prop} from a query loader (SPEC §10.3/§11.2).`,
          );
        };
      }
      const property = witnessReflectGet(target, prop, receiver);
      return typeof property === 'function'
        ? cachedSqlSafetyMethod(
            target,
            prop,
            property,
            methodCache,
            () =>
              (...args: unknown[]) =>
                witnessReflectApply(property, target, args),
          )
        : property;
    },
  });

  witnessWeakMapSet(proxyCache, builder, proxy);
  return proxy;
}

function guardedUnknownSqlMethod(
  target: object,
  prop: PropertyKey,
  value: Function,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
  writePolicy: ManagedSqlWritePolicy | undefined,
  strictSqlTarget: boolean,
): Function {
  return (...args: unknown[]) => {
    const snappedArgs = snapshotAmbiguousSqlMethodArguments(
      target,
      prop,
      args,
      mode,
      writePolicy,
      strictSqlTarget,
    );
    const result = wrapReadonlyEngineResult(
      () => witnessReflectApply(value, target, snappedArgs),
      writePolicy,
    );
    return isRecord(result) &&
      (isManagedDbAdapterLike(result) || isSqlHandleLike(result))
      ? wrapDbAdapter(
          result,
          mode,
          proxyCache,
          methodCache,
          writePolicy,
          strictSqlTarget,
        )
      : result;
  };
}

function snapshotAmbiguousSqlMethodArguments(
  target: object,
  prop: PropertyKey,
  args: readonly unknown[],
  mode: SqlSafetyMode,
  writePolicy: ManagedSqlWritePolicy | undefined,
  strictSqlTarget: boolean,
): readonly unknown[] {
  let foundStatement = false;
  let changed = false;
  const snappedArgs: unknown[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(args, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new Error(
        'KV422: managed SQL method received a sparse or accessor-backed argument list (SPEC §6.6/§10.2).',
      );
    }
    const arg = descriptor.value;
    if (!isSqlStatementCandidate(arg)) {
      appendSqlSafetyValue(snappedArgs, arg);
      continue;
    }
    foundStatement = true;
    const snapshot = enforceManagedSql(arg, mode, writePolicy);
    if (snapshot !== arg) changed = true;
    appendSqlSafetyValue(snappedArgs, snapshot);
  }
  if (foundStatement) {
    return changed ? snappedArgs : args;
  }
  if (writePolicy === undefined || !strictSqlTarget) return args;
  if (isRelationalManagedSqlTarget(target) && isRelationalManagedSqlMethod(prop)) return args;

  throw new Error(
    `KV422: unknown managed DB method ${describeSqlMethod(prop)} is not a proven SQL builder/read capability and did not receive a recognizable SQL carrier (SPEC §10.2/§10.3).`,
  );
}

function managedSqlRootIsStrict(
  target: object,
  writePolicy: ManagedSqlWritePolicy | undefined,
): boolean {
  const classificationTarget = frameworkManagedDbRawTarget(target) ?? target;
  if (writePolicy === undefined) return isManagedDbAdapterLike(classificationTarget);
  return !isDomainTransactionSurface(classificationTarget);
}

function isDomainTransactionSurface(target: object): boolean {
  if (hasDirectManagedSqlAuthoritySurface(target)) return false;
  let owner: object | null = target;
  while (owner !== null) {
    const descriptor = witnessGetOwnPropertyDescriptor(owner, 'transaction');
    if (descriptor !== undefined) {
      return 'value' in descriptor && typeof descriptor.value === 'function';
    }
    owner = witnessGetPrototypeOf(owner);
  }
  return false;
}

function hasDirectManagedSqlAuthoritySurface(target: object): boolean {
  const properties = [
    '$client',
    '$primary',
    '$replicas',
    'all',
    'exec',
    'execute',
    'get',
    'prepare',
    'query',
    'run',
    'session',
    'sql',
    'values',
  ] as const;
  for (let index = 0; index < properties.length; index += 1) {
    let owner: object | null = target;
    while (owner !== null) {
      if (witnessGetOwnPropertyDescriptor(owner, properties[index]!) !== undefined) return true;
      owner = witnessGetPrototypeOf(owner);
    }
  }
  return false;
}

function snapshotDenseSqlMethodArguments(args: readonly unknown[]): readonly unknown[] {
  const snapshot: unknown[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(args, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new Error(
        'KV422: managed SQL method received a sparse or accessor-backed argument list (SPEC §6.6/§10.2).',
      );
    }
    appendSqlSafetyValue(snapshot, descriptor.value);
  }
  return snapshot;
}

function isRelationalManagedSqlTarget(target: object): boolean {
  if (witnessWeakSetHas(relationalManagedSqlTargets, target)) return true;
  const tableConfig = witnessGetOwnPropertyDescriptor(target, 'tableConfig');
  if (tableConfig !== undefined && 'value' in tableConfig && isRecord(tableConfig.value)) {
    witnessWeakSetAdd(relationalManagedSqlTargets, target);
    return true;
  }
  return false;
}

function isRelationalManagedSqlMethod(prop: PropertyKey): boolean {
  return (
    prop === 'all' ||
    prop === 'catch' ||
    prop === 'execute' ||
    prop === 'finally' ||
    prop === 'findFirst' ||
    prop === 'findMany' ||
    prop === 'get' ||
    prop === 'getSQL' ||
    prop === 'prepare' ||
    prop === 'sync' ||
    prop === 'then' ||
    prop === 'toSQL' ||
    prop === 'values'
  );
}

function describeSqlMethod(prop: PropertyKey): string {
  return typeof prop === 'string' ? `db.${prop}` : `db[${String(prop)}]`;
}

function guardedTransactionMethod(
  target: object,
  value: Function,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
  writePolicy: ManagedSqlWritePolicy | undefined,
): Function {
  return (callback: unknown, ...args: unknown[]) => {
    if (writePolicy?.capability === 'read') {
      throw new Error(
        'KV433: read-only SQL capability cannot open db.transaction from a query loader (SPEC §10.3/§11.2).',
      );
    }
    if (typeof callback !== 'function') {
      return witnessReflectApply(value, target, prependSqlSafetyArgument(callback, args));
    }
    if (args.length === 0) {
      const sqlite = runSqliteAsyncTransaction(
        target,
        wrapTransactionDb(target, mode, proxyCache, methodCache, writePolicy),
        (tx) => Promise.resolve(callback(tx)),
      );
      if (sqlite) return sqlite;
    }
    return runQueuedManagedTransaction(target, () =>
      witnessReflectApply(
        value,
        target,
        prependSqlSafetyArgument(
          (tx: unknown) =>
            witnessReflectApply(callback, undefined, [
              wrapTransactionDb(tx, mode, proxyCache, methodCache, writePolicy),
            ]),
          args,
        ),
      ),
    );
  };
}

type SqliteTransactionClient = {
  readonly exec: Function;
  readonly inTransaction: PropertyDescriptor;
  readonly target: Record<PropertyKey, unknown>;
};

export function runSqliteAsyncTransaction<Result>(
  db: unknown,
  transactionDb: unknown,
  callback: (transactionDb: unknown) => Promise<Result>,
): Promise<Result> | undefined {
  const client = sqliteTransactionClient(db);
  if (!client) return undefined;

  const queueTarget = (typeof db === 'object' && db !== null ? db : client.target) as object;
  return runQueuedManagedTransaction(queueTarget, () =>
    runSqliteTransactionControl(client, () => callback(transactionDb)),
  );
}

export function canRunSqliteAsyncTransaction(db: unknown): boolean {
  return sqliteTransactionClient(db) !== undefined;
}

function sqliteTransactionClient(db: unknown): SqliteTransactionClient | undefined {
  const target = frameworkManagedDbRawTarget(db) ?? db;
  if (!isRecord(target)) return undefined;
  const cached = witnessWeakMapGet(pinnedSqliteTransactionClients, target);
  if (cached !== undefined) return cached;

  const direct = pinSqliteTransactionClient(target);
  if (direct !== undefined) {
    witnessWeakMapSet(pinnedSqliteTransactionClients, target, direct);
    return direct;
  }

  const client = strictInheritedDataDescriptor(target, '$client');
  const pinned =
    client !== undefined && 'value' in client
      ? pinSqliteTransactionClient(client.value)
      : undefined;
  if (pinned !== undefined) witnessWeakMapSet(pinnedSqliteTransactionClients, target, pinned);
  return pinned;
}

function pinSqliteTransactionClient(value: unknown): SqliteTransactionClient | undefined {
  if (!isRecord(value)) return undefined;
  try {
    const exec = strictInheritedDataDescriptor(value, 'exec');
    const transaction = strictInheritedDataDescriptor(value, 'transaction');
    const prepare = strictInheritedDataDescriptor(value, 'prepare');
    const inTransaction = strictInheritedDataDescriptor(value, 'inTransaction', true);
    if (
      exec === undefined ||
      !('value' in exec) ||
      typeof exec.value !== 'function' ||
      transaction === undefined ||
      !('value' in transaction) ||
      typeof transaction.value !== 'function' ||
      prepare === undefined ||
      !('value' in prepare) ||
      typeof prepare.value !== 'function' ||
      inTransaction === undefined
    ) {
      return undefined;
    }
    return witnessFreeze({
      exec: exec.value,
      inTransaction: witnessFreeze(inTransaction),
      target: value,
    });
  } catch {
    return undefined;
  }
}

function strictInheritedDataDescriptor(
  value: object,
  property: PropertyKey,
  allowGetter = false,
): PropertyDescriptor | undefined {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = witnessGetOwnPropertyDescriptor(current, property);
    if (descriptor !== undefined) {
      if ('value' in descriptor || (allowGetter && typeof descriptor.get === 'function')) {
        return descriptor;
      }
      throw new TypeError(`SQLite transaction control ${String(property)} must be a data property.`);
    }
    current = witnessGetPrototypeOf(current);
  }
  return undefined;
}

async function runSqliteTransactionControl<Result>(
  client: SqliteTransactionClient,
  callback: () => Promise<Result>,
): Promise<Result> {
  // SPEC §10.3: better-sqlite3 transactions are synchronous, but mutation handlers may be async.
  // Keep the transaction open across the awaited handler with framework-owned control statements.
  const nested = readPinnedSqliteTransactionState(client);
  const savepoint = nested ? `kovo_mutation_${++sqliteSavepointId}` : undefined;

  witnessReflectApply(client.exec, client.target, [
    savepoint === undefined ? 'BEGIN' : `SAVEPOINT ${savepoint}`,
  ]);
  if (readPinnedSqliteTransactionState(client) !== true) {
    throw new Error(
      'KV433: SQLite transaction control did not establish an active frame before mutation code (SPEC §10.3/§11.2).',
    );
  }
  try {
    const result = await callback();
    witnessReflectApply(client.exec, client.target, [
      savepoint === undefined ? 'COMMIT' : `RELEASE ${savepoint}`,
    ]);
    if (readPinnedSqliteTransactionState(client) !== nested) {
      throw new Error(
        'KV433: SQLite transaction control did not close the expected frame after mutation code (SPEC §10.3/§11.2).',
      );
    }
    return result;
  } catch (error) {
    try {
      witnessReflectApply(client.exec, client.target, [
        savepoint === undefined ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}`,
      ]);
      if (savepoint !== undefined) {
        witnessReflectApply(client.exec, client.target, [`RELEASE ${savepoint}`]);
      }
      if (readPinnedSqliteTransactionState(client) !== nested) {
        throw new Error(
          'KV433: SQLite rollback did not restore the prior transaction frame (SPEC §10.3/§11.2).',
        );
      }
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Kovo SQLite mutation transaction rollback failed after a handler error (SPEC §10.3).',
      );
    }
    throw error;
  }
}

function readPinnedSqliteTransactionState(client: SqliteTransactionClient): boolean {
  return 'get' in client.inTransaction && typeof client.inTransaction.get === 'function'
    ? witnessReflectApply(client.inTransaction.get, client.target, []) === true
    : 'value' in client.inTransaction && client.inTransaction.value === true;
}

async function runQueuedManagedTransaction<Result>(
  target: object,
  run: () => Promise<Result> | Result,
): Promise<Result> {
  const previous =
    witnessWeakMapGet(managedTransactionQueue, target) ??
    witnessReflectApply<Promise<void>>(nativePromiseResolve, NativePromise, []);
  const current = witnessReflectApply<Promise<Result>>(nativePromiseThen, previous, [run]);
  const tail = witnessReflectApply<Promise<void>>(nativePromiseThen, current, [
    () => undefined,
    () => undefined,
  ]);
  witnessWeakMapSet(managedTransactionQueue, target, tail);

  try {
    return await current;
  } finally {
    if (witnessWeakMapGet(managedTransactionQueue, target) === tail) {
      witnessWeakMapDelete(managedTransactionQueue, target);
    }
  }
}

function wrapReadonlyEngineResult<Result>(
  execute: () => Result,
  writePolicy: ManagedSqlWritePolicy | undefined,
): Result {
  if (writePolicy?.capability !== 'read' || writePolicy.engineReadonly !== true) {
    return execute();
  }

  try {
    const result = execute();
    if (isPromiseLike(result)) {
      return result.catch((error: unknown) => {
        throw readonlyEngineError(error);
      }) as Result;
    }
    return result;
  } catch (error) {
    throw readonlyEngineError(error);
  }
}

function readonlyEngineError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    [
      'KV433: database engine read-only enforcement rejected a query-loader SQL statement (SPEC §10.3/§11.2).',
      `  engine: ${message}`,
    ].join('\n'),
  );
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function' &&
    typeof (value as { catch?: unknown }).catch === 'function'
  );
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function wrapTransactionDb(
  tx: unknown,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
  writePolicy: ManagedSqlWritePolicy | undefined,
): unknown {
  if (!isRecord(tx)) return tx;
  if (writePolicy === undefined && !isManagedDbAdapterLike(tx)) return tx;
  return wrapDbAdapter(
    tx,
    mode,
    proxyCache,
    methodCache,
    writePolicy,
    managedSqlRootIsStrict(tx, writePolicy),
  );
}

function guardedPrepareMethod(
  target: object,
  value: Function,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
  writePolicy: ManagedSqlWritePolicy | undefined,
): Function {
  return (statement: unknown, ...args: unknown[]) => {
    const snapshot = enforceManagedSql(statement, mode, writePolicy);
    const prepared = wrapReadonlyEngineResult(
      () => witnessReflectApply(value, target, prependSqlSafetyArgument(snapshot, args)),
      writePolicy,
    );
    return typeof prepared === 'object' && prepared !== null
      ? wrapPreparedSqlStatement(prepared, mode, proxyCache, methodCache, writePolicy)
      : prepared;
  };
}

function wrapPreparedSqlStatement(
  statementHandle: object,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
  writePolicy: ManagedSqlWritePolicy | undefined,
): object {
  const cached = witnessWeakMapGet(proxyCache, statementHandle);
  if (cached) return cached;

  const proxy = new Proxy(statementHandle as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = witnessReflectGet(target, prop, receiver);
      if (isPreparedStatementExecutionMethod(prop) && typeof value === 'function') {
        return cachedSqlSafetyMethod(
          target,
          prop,
          value,
          methodCache,
          () =>
            (...args: unknown[]) =>
              wrapReadonlyEngineResult(() => witnessReflectApply(value, target, args), writePolicy),
        );
      }

      return typeof value === 'function'
        ? cachedSqlSafetyMethod(
            target,
            prop,
            value,
            methodCache,
            () =>
              (...args: unknown[]) =>
                witnessReflectApply(value, target, args),
          )
        : value;
    },
  });

  witnessWeakMapSet(proxyCache, statementHandle, proxy);
  return proxy;
}

/**
 * The single managed SQL runtime choke (SPEC §10.3/§11.2). Every framework-owned DB handle path
 * that can execute caller-provided SQL text must route through this function before reaching the
 * underlying driver.
 *
 * @internal
 */
export const enforceManagedSql = securityClassifier(
  'server.sql.enforce-managed-sql',
  function (
    statement: unknown,
    mode: SqlSafetyMode,
    writePolicy: ManagedSqlWritePolicy | undefined,
  ): ManagedSqlStatement {
    void mode;
    const snapshot = snapshotManagedSqlStatement(statement, writePolicy?.dialect);
    if (snapshot.ok) {
      assertSqlWriteTablesAllowed(snapshot.statement, writePolicy);
      return snapshot.statement;
    }
    const validation = validateManagedSqlStatement(statement);
    if (validation.ok) throw new Error(SQL_SNAPSHOT_FAILURE_MESSAGE);
    throw new Error(validation.message);
  },
);

const assertSqlWriteTablesAllowed = securityClassifier(
  'server.sql.write-table-allowlist',
  function (statement: unknown, writePolicy: ManagedSqlWritePolicy | undefined): void {
    if (writePolicy?.capability === 'read') {
      if (writePolicy.engineReadonly === true) return;
      assertReadSqlStatement(statement, writePolicy?.dialect);
      return;
    }

    const declaredTables = writePolicy?.tables;
    if (writePolicy === undefined) return;

    const sql = sqlStatementText(statement);
    if (sql === undefined) return;

    const verdict = classifyManagedSql(sql, writePolicy?.dialect);
    if (verdict.kind === 'proven-safe') return;
    if (verdict.kind === 'unproven') {
      throw new Error(
        [
          'KV406: raw-SQL write table allowlist could not prove an executable statement read-only or table-resolved on a managed mutation DB handle (SPEC §10.3/§11.2).',
          `  reason: ${verdict.reason}`,
        ].join('\n'),
      );
    }

    const writeTables = verdict.detail;
    assertNoSecretRawWriteBind(statement);
    const writeTableNames: string[] = [];
    for (let index = 0; index < writeTables.length; index += 1) {
      const table = writeTables[index]!;
      if (table === UNTABLED_SQL_WRITE) {
        throw new Error(
          'KV406: raw-SQL write table allowlist encountered a write with no provable table allowlist target on a managed mutation DB handle (SPEC §10.3/§11.2).',
        );
      }
      if (isParsedSqlTableName(table)) {
        appendSqlSafetyValue(
          writeTableNames,
          normalizeManagedSqlTableName(table, writePolicy?.dialect),
        );
      }
    }
    const allowed = createWitnessSet<string>();
    const declared = declaredTables ?? [];
    for (let index = 0; index < declared.length; index += 1) {
      witnessSetAdd(allowed, normalizeManagedSqlTableName(declared[index]!, writePolicy?.dialect));
    }
    const unexpected: string[] = [];
    for (let index = 0; index < writeTableNames.length; index += 1) {
      const table = writeTableNames[index]!;
      if (!witnessSetHas(allowed, table)) appendSqlSafetyValue(unexpected, table);
    }
    if (unexpected.length === 0) return;

    throwUnexpectedSqlWriteTables(unexpected, declaredTables, writePolicy);
  },
);

function throwUnexpectedSqlWriteTables(
  unexpected: readonly string[],
  declaredTables: readonly string[] | undefined,
  writePolicy: ManagedSqlWritePolicy,
): never {
  throw new Error(
    [
      'KV406: raw-SQL write touched table(s) outside the declared mutation registry tables (SPEC §10.3/§11.2).',
      `  unexpected: ${[...new Set(unexpected)].sort().join(', ')}`,
      `  declared tables: ${[...new Set(declaredTables ?? [])].sort().join(', ') || '<none>'}`,
      `  touches: ${[...new Set(writePolicy.touches ?? [])].sort().join(', ') || '<none>'}`,
    ].join('\n'),
  );
}

const assertReadSqlStatement = securityClassifier(
  'server.sql.read-only-statement',
  function (statement: unknown, dialect: ParseSqlWriteTablesOptions['dialect']): void {
    const sql = sqlStatementText(statement);
    if (sql === undefined) return;

    const verdict = classifyManagedSql(sql, dialect);
    if (verdict.kind === 'proven-safe') return;

    throw new Error(
      [
        verdict.kind === 'unproven'
          ? 'KV433: framework read-only SQL choke could not prove an executable statement read-only on a managed query DB handle (SPEC §10.3/§11.2).'
          : 'KV433: framework read-only SQL choke rejected a mutating statement from a query loader (SPEC §10.3/§11.2).',
        verdict.kind === 'unproven'
          ? `  reason: ${verdict.reason}`
          : `  tables: ${formatSqlWriteTargets(verdict.detail)}`,
      ].join('\n'),
    );
  },
);

const classifyManagedSql = securityClassifier(
  'server.sql.classify-managed-sql',
  function (
    sql: string,
    dialect: ParseSqlWriteTablesOptions['dialect'],
  ): SqlClassifierVerdict<SqlWriteTargets> {
    const primary = classifyStatement(sql, { dialect });
    if (primary.kind !== 'unproven' || dialect !== undefined) return primary;

    const sqlite = classifyStatement(sql, { dialect: 'sqlite' });
    if (sqlite.kind !== 'unproven') return sqlite;
    return primary;
  },
);

function formatSqlWriteTargets(targets: readonly ParsedSqlWriteTarget[]): string {
  let formatted = '';
  for (let index = 0; index < targets.length; index += 1) {
    if (index > 0) formatted += ', ';
    const target = targets[index]!;
    formatted += target === UNTABLED_SQL_WRITE ? '<untabled write>' : target;
  }
  return formatted;
}

function normalizeManagedSqlTableName(
  table: string,
  dialect: ParseSqlWriteTablesOptions['dialect'],
): string {
  if (intrinsicStringIncludes(table, '.')) return table;
  return `${dialect === 'sqlite' ? 'main' : 'public'}.${table}`;
}

function isParsedSqlTableName(target: ParsedSqlWriteTarget): target is string {
  return target !== UNTABLED_SQL_WRITE;
}

function sqlStatementText(statement: unknown): string | undefined {
  const snapshot = snapshotManagedSqlStatement(statement);
  return snapshot.ok ? snapshot.statement.text : undefined;
}

function assertNoSecretRawWriteBind(statement: unknown): void {
  const snapshot = snapshotManagedSqlStatement(statement);
  if (snapshot.ok) assertNoSecretDbWriteValue(snapshot.statement.values);
}

function assertNoSecretDbWriteValue(value: unknown): void {
  if (containsSecret(value, createWitnessWeakSet<object>())) {
    throw new Error(
      'KV435: Secret runtime value cannot be written through a managed DB write boundary (SPEC §10.3/§11.2). Call reveal(reason) at an audited site before writing.',
    );
  }
}

function containsSecret(value: unknown, seen: WeakSet<object>): boolean {
  if (isSecret(value)) return true;
  if (typeof value !== 'object' || value === null) return false;
  if (witnessWeakSetHas(seen, value)) return false;
  witnessWeakSetAdd(seen, value);
  if (witnessIsArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(value, index);
      if (
        descriptor !== undefined &&
        'value' in descriptor &&
        containsSecret(descriptor.value, seen)
      ) {
        return true;
      }
    }
    return false;
  }
  const keys = witnessObjectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, keys[index]!);
    if (
      descriptor !== undefined &&
      'value' in descriptor &&
      containsSecret(descriptor.value, seen)
    ) {
      return true;
    }
  }
  return false;
}

function isManagedDbAdapterLike(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  try {
    if (isDbAdapterLike(value)) return true;
    const record = value as Record<PropertyKey, unknown>;
    return (
      typeof record.all === 'function' ||
      typeof record.get === 'function' ||
      typeof record.run === 'function' ||
      typeof record.values === 'function' ||
      isSqlHandleLike(record.session)
    );
  } catch {
    return true;
  }
}

function isNestedSqlHandleProperty(prop: PropertyKey): boolean {
  return isSqlHandleProperty(prop) || prop === 'session';
}

function isManagedRawDriverEscapeProperty(prop: PropertyKey): boolean {
  return prop === '$client' || prop === '$primary' || prop === '$replicas' || prop === 'session';
}

function isSqlStatementCandidate(value: unknown): boolean {
  if (typeof value === 'string') return looksLikeSqlStatement(value);
  if (typeof value !== 'object' || value === null) return false;

  const text = witnessGetOwnPropertyDescriptor(value, 'text');
  const sql = witnessGetOwnPropertyDescriptor(value, 'sql');
  const chunks = witnessGetOwnPropertyDescriptor(value, 'queryChunks');
  const getSql = witnessGetOwnPropertyDescriptor(value, 'getSQL');
  return (
    (text !== undefined && 'value' in text && typeof text.value === 'string') ||
    (sql !== undefined && 'value' in sql && typeof sql.value === 'string') ||
    (chunks !== undefined && 'value' in chunks && witnessIsArray(chunks.value)) ||
    (getSql !== undefined && 'value' in getSql && typeof getSql.value === 'function')
  );
}

function looksLikeSqlStatement(value: string): boolean {
  const first = firstSqlWord(value);
  const statements = [
    'alter',
    'begin',
    'call',
    'commit',
    'create',
    'delete',
    'drop',
    'exec',
    'execute',
    'explain',
    'insert',
    'merge',
    'pragma',
    'replace',
    'rollback',
    'savepoint',
    'select',
    'truncate',
    'update',
    'vacuum',
    'with',
  ] as const;
  for (let index = 0; index < statements.length; index += 1) {
    if (statements[index] === first) return true;
  }
  return false;
}

function firstSqlWord(value: string): string {
  let index = 0;
  while (index < value.length && isSqlWhitespace(value[index]!)) index += 1;
  let word = '';
  while (index < value.length && isAsciiLetter(value[index]!)) {
    word += asciiLowerCharacter(value[index]!);
    index += 1;
  }
  return word;
}

function asciiLower(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    result += asciiLowerCharacter(value[index]!);
  }
  return result;
}

function asciiLowerCharacter(value: string): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  for (let index = 0; index < upper.length; index += 1) {
    if (upper[index] === value) return lower[index]!;
  }
  return value;
}

function intrinsicStringIncludes(value: string, search: string): boolean {
  if (search.length === 0) return true;
  for (let index = 0; index + search.length <= value.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < search.length; offset += 1) {
      if (value[index + offset] !== search[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function isAsciiLetter(value: string): boolean {
  const lower = asciiLowerCharacter(value);
  return lower >= 'a' && lower <= 'z';
}

function isSqlWhitespace(value: string): boolean {
  return (
    value === ' ' ||
    value === '\t' ||
    value === '\n' ||
    value === '\r' ||
    value === '\f' ||
    value === '\v' ||
    value === '\u00a0' ||
    value === '\ufeff'
  );
}

function isDirectSqlExecutionMethod(prop: PropertyKey): boolean {
  return (
    prop === 'query' ||
    prop === 'exec' ||
    prop === 'execute' ||
    prop === 'all' ||
    prop === 'get' ||
    prop === 'run' ||
    prop === 'values'
  );
}

function cachedSqlSafetyMethod(
  target: object,
  prop: PropertyKey,
  value: Function,
  cache: WeakMap<object, Map<PropertyKey, Function>>,
  factory: () => Function,
): Function {
  let targetCache = witnessWeakMapGet(cache, target);
  if (!targetCache) {
    targetCache = createWitnessMap();
    witnessWeakMapSet(cache, target, targetCache);
  }
  const cached = witnessMapGet(targetCache, prop);
  if (cached) return cached;

  const next = factory();
  witnessMapSet(targetCache, prop, next);
  return next;
}

function appendSqlSafetyValue<Value>(values: Value[], value: Value): void {
  witnessDefineProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function prependSqlSafetyArgument(first: unknown, rest: readonly unknown[]): readonly unknown[] {
  const args: unknown[] = [];
  appendSqlSafetyValue(args, first);
  for (let index = 0; index < rest.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(rest, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new Error(
        'KV422: managed SQL invocation received a sparse or accessor-backed argument list (SPEC §6.6/§10.2).',
      );
    }
    appendSqlSafetyValue(args, descriptor.value);
  }
  return args;
}
