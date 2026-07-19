import { compileComponentModule } from './compile.js';
import { compilerEmittedSourceProvenanceToken } from './source-provenance.js';
import type {
  CompileComponentOptions,
  CompileResult,
  EmittedFile,
  InternalCompileComponentOptions,
} from './types.js';

type EmittedFileByKind = Partial<Record<EmittedFile['kind'], EmittedFile>>;

export interface CompileFixtureResult extends CompileResult {
  filesByKind: EmittedFileByKind;
}

export function compileFixture(options: CompileComponentOptions): CompileFixtureResult {
  const result = compileComponentModule(options);
  const filesByKind: EmittedFileByKind = {};

  for (const file of result.files) {
    filesByKind[file.kind] = file;
  }

  return { ...result, filesByKind };
}

/**
 * Compile synthetic lowered IR in tests. SPEC.md §5.2 reserves residual Kovo stamps for
 * compiler-owned output, so downstream validator fixtures carry the same unforgeable provenance
 * as the compiler's real fixpoint pass instead of pretending the IR was app-authored.
 */
export function compileCompilerEmittedFixture(options: CompileComponentOptions): CompileResult {
  const internalOptions: InternalCompileComponentOptions = {
    ...options,
    sourceProvenance: compilerEmittedSourceProvenanceToken(),
  };
  // The public entrypoint intentionally hides compiler-owned provenance from callers. This test
  // helper possesses the module-private runtime token and mirrors assertFixpoint's internal bridge.
  return compileComponentModule(internalOptions as unknown as CompileComponentOptions);
}
