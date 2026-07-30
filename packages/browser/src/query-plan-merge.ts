import {
  applyCompiledQueryUpdatePlan,
  type ApplyCompiledQueryUpdatePlanOptions,
  type CompiledQueryUpdateApplier,
  type CompiledQueryUpdateContext,
  type CompiledQueryUpdatePlanEntry,
  type CompiledQueryUpdatePlans,
  type QueryBindingRoot,
} from './query-bindings.js';
import { queryStoreKey } from './query-store.js';
import {
  applySecurityIntrinsic,
  defineSecurityProperties,
  freezeSecurityValue,
  securityArrayIsArray,
  securityGetOwnPropertyDescriptor,
  securityNullRecord,
  securityObjectKeys,
  securityOwnArrayEntry,
} from './security-witness-intrinsics.js';

/**
 * One compiler-emitted component plan map plus its local-alias → runtime-query-name mapping.
 *
 * @generated Bootstrap/runtime ABI only.
 */
export interface CompiledQueryUpdatePlanSource {
  plans: CompiledQueryUpdatePlans;
  queryNames?: Readonly<Record<string, string>>;
}

/**
 * Merge component-local generated plans into one source-derived runtime query registry.
 *
 * @generated Compiler bootstraps call this captured-intrinsic helper instead of evaluating
 * `Object.keys()` after authored client modules have run.
 */
export function mergeCompiledQueryUpdatePlans(
  sources: readonly CompiledQueryUpdatePlanSource[],
): CompiledQueryUpdatePlans {
  if (!securityArrayIsArray(sources)) {
    throw new TypeError('Kovo query-plan sources must be arrays.');
  }

  const merged = securityNullRecord<CompiledQueryUpdatePlanEntry>();
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const sourceEntry = securityOwnArrayEntry(sources, sourceIndex);
    if (!sourceEntry.ok || typeof sourceEntry.value !== 'object' || sourceEntry.value === null) {
      throw new TypeError('Kovo query-plan sources must be dense.');
    }
    const plans = requiredOwnRecord(sourceEntry.value, 'plans') as CompiledQueryUpdatePlans;
    const queryNames = optionalOwnRecord(sourceEntry.value, 'queryNames');

    const localNames = securityObjectKeys(plans);
    for (let planIndex = 0; planIndex < localNames.length; planIndex += 1) {
      const localNameEntry = securityOwnArrayEntry(localNames, planIndex);
      if (!localNameEntry.ok || localNameEntry.value.length === 0) {
        throw new TypeError('Kovo query-plan names are invalid.');
      }
      const localName = localNameEntry.value;
      const planDescriptor = securityGetOwnPropertyDescriptor(plans, localName);
      if (!planDescriptor || !('value' in planDescriptor)) {
        throw new TypeError('Kovo query plans require own data.');
      }
      if (planDescriptor.value === undefined) continue;
      const plan = requirePlanEntry(planDescriptor.value);
      const runtimeName = mappedRuntimeQueryName(queryNames, localName);
      // Reuse the store identity validator so emitted plan registries cannot mint a name the wire
      // and store would later reject.
      queryStoreKey(runtimeName, undefined);

      const next = normalizePlanApplier(localName, plan);
      const existingDescriptor = securityGetOwnPropertyDescriptor(merged, runtimeName);
      const existing =
        existingDescriptor && 'value' in existingDescriptor
          ? (existingDescriptor.value as CompiledQueryUpdateApplier)
          : undefined;
      const combined: CompiledQueryUpdateApplier =
        existing === undefined
          ? next
          : (root, value, context = {}) => {
              applySecurityIntrinsic(existing, undefined, [root, value, context]);
              return applySecurityIntrinsic(next, undefined, [root, value, context]);
            };
      defineSecurityProperties(merged, {
        [runtimeName]: {
          configurable: true,
          enumerable: true,
          value: combined,
          writable: false,
        },
      });
    }
  }
  return freezeSecurityValue(merged);
}

function normalizePlanApplier(
  localName: string,
  plan: CompiledQueryUpdatePlanEntry,
): CompiledQueryUpdateApplier {
  if (typeof plan === 'function') {
    return (root, value, context = {}) =>
      applySecurityIntrinsic(plan, undefined, [root, value, context]);
  }
  return (root: QueryBindingRoot, value: unknown, context: CompiledQueryUpdateContext = {}) =>
    applyCompiledQueryUpdatePlan(root, localName, value, plan, contextOptions(context));
}

function contextOptions(context: CompiledQueryUpdateContext): ApplyCompiledQueryUpdatePlanOptions {
  const queryIdentity = securityGetOwnPropertyDescriptor(context, 'queryIdentity');
  const queryStore = securityGetOwnPropertyDescriptor(context, 'queryStore');
  if (queryIdentity && !('value' in queryIdentity)) {
    throw new TypeError('Kovo generated query-plan context.queryIdentity must be own data.');
  }
  if (queryStore && !('value' in queryStore)) {
    throw new TypeError('Kovo generated query-plan context.queryStore must be own data.');
  }
  return {
    ...(queryIdentity && queryIdentity.value !== undefined
      ? {
          queryIdentity: queryIdentity.value as NonNullable<
            CompiledQueryUpdateContext['queryIdentity']
          >,
        }
      : {}),
    ...(queryStore && queryStore.value !== undefined
      ? { queryStore: queryStore.value as NonNullable<CompiledQueryUpdateContext['queryStore']> }
      : {}),
  };
}

function mappedRuntimeQueryName(
  queryNames: Readonly<Record<string, unknown>> | undefined,
  localName: string,
): string {
  if (queryNames === undefined) return localName;
  const descriptor = securityGetOwnPropertyDescriptor(queryNames, localName);
  if (descriptor === undefined) return localName;
  if (!('value' in descriptor) || typeof descriptor.value !== 'string') {
    throw new TypeError('Kovo query-name mappings require strings.');
  }
  return descriptor.value;
}

function requirePlanEntry(value: unknown): CompiledQueryUpdatePlanEntry {
  if (typeof value === 'function') return value as CompiledQueryUpdateApplier;
  if (typeof value === 'object' && value !== null && !securityArrayIsArray(value)) {
    return value as CompiledQueryUpdatePlanEntry;
  }
  throw new TypeError('Kovo query-plan entry is invalid.');
}

function requiredOwnRecord(value: object, key: string): object {
  const descriptor = securityGetOwnPropertyDescriptor(value, key);
  if (
    !descriptor ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'object' ||
    descriptor.value === null ||
    securityArrayIsArray(descriptor.value)
  ) {
    throw new TypeError(`Kovo generated query-plan ${key} must be an own record.`);
  }
  return descriptor.value;
}

function optionalOwnRecord(
  value: object,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  const descriptor = securityGetOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || ('value' in descriptor && descriptor.value === undefined)) {
    return undefined;
  }
  if (
    !('value' in descriptor) ||
    typeof descriptor.value !== 'object' ||
    descriptor.value === null ||
    securityArrayIsArray(descriptor.value)
  ) {
    throw new TypeError(`Kovo generated query-plan ${key} must be an own record.`);
  }
  return descriptor.value as Readonly<Record<string, unknown>>;
}
