import { applyCompiledQueryUpdatePlan } from './query-bindings.js';
import type {
  AppliedCompiledQueryUpdatePlan,
  ApplyCompiledQueryUpdatePlanOptions,
  CompiledQueryUpdatePlan,
  QueryBindingRoot,
} from './query-bindings.js';

/**
 * @generated Compiler-emitted query update plan VM entrypoint.
 *
 * SPEC.md §§4.4, 4.8, 4.9, 5.2, 9.1, and 13.2: generated client modules pass
 * data/selectors into this runtime-owned VM instead of embedding a second plan
 * interpreter. The compatibility name remains in `query-bindings.ts` for
 * repo-internal callers; compiler output should import this generated ABI.
 */
export function runQueryUpdatePlan(
  root: QueryBindingRoot,
  queryName: string,
  value: unknown,
  plan: CompiledQueryUpdatePlan = {},
  options: ApplyCompiledQueryUpdatePlanOptions = {},
): AppliedCompiledQueryUpdatePlan {
  return applyCompiledQueryUpdatePlan(root, queryName, value, plan, options);
}

export type {
  AppliedCompiledQueryUpdatePlan,
  ApplyCompiledQueryUpdatePlanOptions,
  CompiledQueryDerive,
  CompiledQueryStamp,
  CompiledQueryTemplateStamp,
  CompiledQueryUpdateContext,
  CompiledQueryUpdatePlan,
  CompiledQueryUpdatePlans,
} from './query-bindings.js';
