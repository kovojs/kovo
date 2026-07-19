import type { ScopedKey } from '@kovojs/core';
import { principalScopedKey } from '@kovojs/core/internal/storage';

import { frameworkSessionPrincipalPostureFromRequest } from './auth-principal.js';

/**
 * Bind an application key to the framework-authenticated principal on this request.
 *
 * The principal is read from Kovo's private request snapshot, never from an app-supplied id. An
 * anonymous or unresolved request therefore cannot accidentally collapse into a shared namespace.
 */
export function scopedKey(request: unknown, key: string): ScopedKey {
  const posture = frameworkSessionPrincipalPostureFromRequest(request);
  if (posture === undefined) {
    throw new TypeError(
      'KV450: scopedKey(request, key) requires the framework-owned session request carrier; app-created session-shaped objects are not authority.',
    );
  }
  if (posture.kind !== 'proven') {
    throw new TypeError(
      'KV450: scopedKey(request, key) requires a framework-resolved principal; use the explicit publicScopedKey(key) posture only for intentionally shared state.',
    );
  }
  return principalScopedKey(posture.principal, key);
}
