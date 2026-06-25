const compilerEmittedSourceProvenance = Object.freeze({ kind: 'compiler-emitted' });

/** @internal Non-public marker for compiler-generated artifacts accepted by SPEC.md §5.2 fixpoint. */
export type CompilerEmittedSourceProvenance = typeof compilerEmittedSourceProvenance;

/** @internal Source provenance marker intentionally not exported from public package entrypoints. */
export function compilerEmittedSourceProvenanceToken(): CompilerEmittedSourceProvenance {
  return compilerEmittedSourceProvenance;
}

/** @internal Only the compiler-owned marker can suppress app authoring-surface diagnostics. */
export function isCompilerEmittedSourceProvenance(
  value: unknown,
): value is CompilerEmittedSourceProvenance {
  return value === compilerEmittedSourceProvenance;
}
