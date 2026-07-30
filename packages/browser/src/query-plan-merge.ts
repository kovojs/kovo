import {
  applyCompiledQueryUpdatePlan,
  queryBindingRootMatchesIdentity,
  type ApplyCompiledQueryUpdatePlanOptions,
  type CompiledQueryUpdateApplier,
  type CompiledQueryUpdateContext,
  type CompiledQueryUpdatePlanEntry,
  type CompiledQueryUpdatePlans,
  type QueryBindingRoot,
} from './query-bindings.js';
import { queryRuntimeElements } from './runtime-dom-security.js';
import {
  applySecurityIntrinsic,
  freezeSecurityValue,
  securityArrayIsArray,
  securityGetOwnPropertyDescriptor,
  securityNullRecord,
  securityObjectKeys,
  securityOwnArrayEntry,
  securitySet,
  securitySetAdd,
  securitySetHas,
} from './security-witness-intrinsics.js';

/**
 * One compiler-emitted component plan map plus its local-alias → runtime-query-name mapping.
 *
 * @generated Bootstrap/runtime ABI only.
 */
export interface CompiledQueryUpdatePlanSource {
  ownerSelector: string;
  plans: CompiledQueryUpdatePlans;
  queryNames: Readonly<Record<string, string>>;
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
    invalidQueryPlan();
  }

  const merged = securityNullRecord<CompiledQueryUpdatePlanEntry>();
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const sourceEntry = securityOwnArrayEntry(sources, sourceIndex);
    if (!sourceEntry.ok || typeof sourceEntry.value !== 'object' || sourceEntry.value === null) {
      invalidQueryPlan();
    }
    const source = sourceEntry.value as CompiledQueryUpdatePlanSource;
    const ownerSelector = source.ownerSelector;
    const plans = source.plans;
    const queryNames = source.queryNames;
    const sourceRuntimeNames = securitySet<string>();

    const localNames = securityObjectKeys(plans);
    for (let planIndex = 0; planIndex < localNames.length; planIndex += 1) {
      const localNameEntry = securityOwnArrayEntry(localNames, planIndex);
      if (!localNameEntry.ok || localNameEntry.value.length === 0) {
        invalidQueryPlan();
      }
      const localName = localNameEntry.value;
      const planDescriptor = securityGetOwnPropertyDescriptor(plans, localName);
      if (!planDescriptor || !('value' in planDescriptor)) {
        invalidQueryPlan();
      }
      if (planDescriptor.value === undefined) continue;
      const plan = planDescriptor.value;
      const runtimeName = mappedRuntimeQueryName(queryNames, localName);
      // Clock-only plan entries and other non-query channels are intentionally absent from the
      // compiler's alias map. The explicit clock scheduler remains their sole DOM writer.
      if (runtimeName === undefined) continue;
      if (securitySetHas(sourceRuntimeNames, runtimeName)) {
        invalidQueryPlan();
      }
      securitySetAdd(sourceRuntimeNames, runtimeName);

      const next = ownedPlanApplier(
        ownerSelector,
        runtimeName,
        normalizePlanApplier(localName, plan),
      );
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
      (merged as Record<string, CompiledQueryUpdatePlanEntry>)[runtimeName] = combined;
    }
  }
  return freezeSecurityValue(merged);
}

function ownedPlanApplier(
  ownerSelector: string,
  runtimeName: string,
  applyPlan: CompiledQueryUpdateApplier,
): CompiledQueryUpdateApplier {
  return (root, value, context = {}) => {
    const identity = contextOptions(context).queryIdentity;
    if (!identity || identity.name !== runtimeName) invalidQueryPlan();
    const owners = queryRuntimeElements<QueryBindingRoot>(root, ownerSelector);
    let result: unknown;
    for (let index = 0; index < owners.length; index += 1) {
      const ownerEntry = securityOwnArrayEntry(owners, index);
      if (!ownerEntry.ok) invalidQueryPlan();
      if (!queryBindingRootMatchesIdentity(ownerEntry.value, identity)) continue;
      result = applySecurityIntrinsic(applyPlan, undefined, [ownerEntry.value, value, context]);
    }
    return result;
  };
}

function normalizePlanApplier(
  localName: string,
  plan: CompiledQueryUpdatePlanEntry,
): CompiledQueryUpdateApplier {
  if (typeof plan === 'function') return plan;
  return (root: QueryBindingRoot, value: unknown, context: CompiledQueryUpdateContext = {}) =>
    applyCompiledQueryUpdatePlan(root, localName, value, plan, contextOptions(context));
}

function contextOptions(context: CompiledQueryUpdateContext): ApplyCompiledQueryUpdatePlanOptions {
  const queryIdentity = securityGetOwnPropertyDescriptor(context, 'queryIdentity');
  const queryStore = securityGetOwnPropertyDescriptor(context, 'queryStore');
  if (queryIdentity && !('value' in queryIdentity)) {
    invalidQueryPlan();
  }
  if (queryStore && !('value' in queryStore)) {
    invalidQueryPlan();
  }
  return {
    queryIdentity:
      queryIdentity && 'value' in queryIdentity
        ? (queryIdentity.value as CompiledQueryUpdateContext['queryIdentity'])
        : undefined,
    queryStore:
      queryStore && 'value' in queryStore
        ? (queryStore.value as CompiledQueryUpdateContext['queryStore'])
        : undefined,
  };
}

function mappedRuntimeQueryName(
  queryNames: Readonly<Record<string, unknown>>,
  localName: string,
): string | undefined {
  const descriptor = securityGetOwnPropertyDescriptor(queryNames, localName);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor) || typeof descriptor.value !== 'string') {
    invalidQueryPlan();
  }
  return descriptor.value;
}

function invalidQueryPlan(): never {
  throw new TypeError('Invalid Kovo query plan.');
}
