import { compilerOwnedViteClientModuleRole } from '@kovojs/compiler/internal';

import { pinCompilerOwnedClientModuleRole } from './compiler-client-module-provenance.js';

/**
 * @internal Carry genuine compiler identity through a server-owned defensive snapshot.
 *
 * This is the only server module that imports the compiler verifier. Production app and generated
 * handler graphs consume the runtime-only provenance leaf instead, so TypeScript cannot become a
 * retained server dependency. The role remains out-of-band: spreading, serializing, proxying, or
 * reconstructing `pinned` cannot copy this WeakMap membership.
 */
export function pinCompilerOwnedClientModule<Value extends object>(
  source: unknown,
  pinned: Value,
): Value {
  const role = compilerOwnedViteClientModuleRole(source);
  return role === undefined ? pinned : pinCompilerOwnedClientModuleRole(pinned, role);
}
