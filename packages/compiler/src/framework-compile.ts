import { compileComponentModule } from './compile.js';
import { snapshotCompileComponentOptions } from './compile-options.js';
import type { CompileComponentOptions, CompileResult } from './types.js';

/**
 * @internal Compile through the genuine compiler without retaining cross-invocation state.
 *
 * SPEC.md §2 / §6.6: authored config and app code share the compiler's UID, so stable on-disk
 * authentication cannot distinguish framework output from same-UID forgery. Ambient package-prefix
 * manifests also make a declared-input-only process cache incomplete. Framework runners therefore
 * pin the complete carrier and compile it fresh.
 */
export async function compileComponentModuleForFramework(
  options: CompileComponentOptions,
): Promise<CompileResult> {
  return compileComponentModule(snapshotCompileComponentOptions(options));
}
