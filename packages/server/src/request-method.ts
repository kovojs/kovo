/* oxlint-disable typescript/unbound-method -- Boot-captured string control is invoked through pinned Reflect.apply. */

import { witnessReflectApply } from './security-witness-intrinsics.js';

const nativeStringToUpperCase = String.prototype.toUpperCase;
const requestMethodControlSound =
  witnessReflectApply<string>(nativeStringToUpperCase, 'post', []) === 'POST' &&
  witnessReflectApply<string>(nativeStringToUpperCase, 'GET', []) === 'GET' &&
  witnessReflectApply<string>(nativeStringToUpperCase, 'x-kovo_1', []) === 'X-KOVO_1';

/** @internal Canonicalize a request method through the boot-captured, semantically checked control. */
export function canonicalRequestMethod(method: string): string {
  if (!requestMethodControlSound) {
    throw new TypeError('Kovo request method classification controls are unavailable.');
  }
  return witnessReflectApply<string>(nativeStringToUpperCase, method, []);
}

/** @internal Whether a method is in SPEC §9.1's complete safe-method set. */
export function isSafeEndpointMethod(method: string): boolean {
  const canonical = canonicalRequestMethod(method);
  return canonical === 'GET' || canonical === 'HEAD' || canonical === 'OPTIONS';
}
