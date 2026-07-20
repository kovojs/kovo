import { canonicalJsonStringify } from '@kovojs/core/internal/json';

import { frameworkEgressFetch } from './egress.js';
import { securityEventChainHead, securityEventSnapshot } from './security-event.js';

/**
 * Export the bounded redacted journal only through the declared-egress door.
 * The MAC chain protects this exported/at-rest carrier; it is not a completeness claim.
 *
 * @internal
 */
export async function exportSecurityEvents(destination: string): Promise<Response> {
  return frameworkEgressFetch(destination, {
    body: canonicalJsonStringify({
      events: securityEventSnapshot(),
      head: securityEventChainHead(),
      schema: 'kovo-security-event-export/v1',
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    redirect: 'error',
  });
}
