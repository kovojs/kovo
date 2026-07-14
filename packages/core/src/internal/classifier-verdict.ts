/** @internal Three-valued security classifier verdict (SPEC §10.3/§11.2 fail-closed sinks). */
export type ClassifierVerdict<UnsafeDetail = never> =
  | { readonly kind: 'proven-safe' }
  | { readonly detail: UnsafeDetail; readonly kind: 'proven-unsafe' }
  | { readonly kind: 'unproven'; readonly reason: string };

/** @internal Convenience singleton for classifier branches that are positively proven safe. */
export const PROVEN_SAFE: ClassifierVerdict<never> = { kind: 'proven-safe' };

/** @internal Build a classifier verdict for a positively proven unsafe branch. */
export function provenUnsafe<UnsafeDetail>(detail: UnsafeDetail): ClassifierVerdict<UnsafeDetail> {
  return { detail, kind: 'proven-unsafe' };
}

/** @internal Build a classifier verdict for a branch the framework could not prove safe. */
export function unproven(reason: string): ClassifierVerdict<never> {
  return { kind: 'unproven', reason };
}

/** @internal Throws for both unsafe and unproven verdicts; only proven-safe reaches the sink. */
export function enforceOrThrow<UnsafeDetail>(
  verdict: ClassifierVerdict<UnsafeDetail>,
  closedError: (
    verdict: Extract<ClassifierVerdict<UnsafeDetail>, { kind: 'proven-unsafe' | 'unproven' }>,
  ) => Error,
): void {
  if (verdict.kind === 'proven-safe') return;
  throw closedError(verdict);
}

export {
  lockRequestSafeNodeBuiltinFacades,
  lockRequestSafeNodeBuiltinFacadesWithInventory,
  lockRequestSafeRuntimeRealm,
  lockRequestSafeRuntimeRealmWithInventory,
  requestSafeCallbackGlobals,
  requestSafeGlobalCallables,
  requestSafeGlobalConstructors,
  requestSafeGlobalNamespaces,
  requestSafeNodeBuiltinModules,
  requestSafeRuntimeInventory,
} from './request-safe-runtime-inventory.ts';
export type { RequestSafeRuntimeGlobalInventory } from './request-safe-runtime-inventory.ts';
