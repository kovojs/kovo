import { assertRequestSafeRuntimeRealmLocked } from '@kovojs/core/internal/classifier-verdict';

const NativeTypeError = globalThis.TypeError;

/**
 * Require the supported runner's irreversible realm lock before Better Auth sees any secret.
 *
 * This assertion never establishes trust itself. The runner must have locked the realm before the
 * authored graph evaluated; this boundary only refuses to pass signing material or passwords into
 * Better Auth when that persistent ordering proof is absent or has drifted (SPEC §6.6 rule 6).
 * Generated Kovo runners provide that bootstrap-first proof. This package-local witness cannot
 * retroactively authenticate a privileged custom host that already evaluated `@kovojs/server`;
 * preloading that framework graph before its bootstrap is unsupported host misuse.
 *
 * @internal
 */
export function assertBetterAuthRuntimeRealmLocked(): void {
  try {
    assertRequestSafeRuntimeRealmLocked();
  } catch {
    throw new NativeTypeError(
      'Kovo Better Auth refuses evaluation before the request-safe runtime realm lock; import the supported runtime bootstrap before the Better Auth graph (SPEC §6.6 rule 6).',
    );
  }
}

// This module is a standalone packed entry. Eager refusal prevents the package entry from
// evaluating any dependency that could receive environment-backed signing material first.
assertBetterAuthRuntimeRealmLocked();
