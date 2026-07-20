import { canonicalJsonStringify } from '@kovojs/core/internal/json';

import { frameworkEgressFetch } from './egress.js';
import {
  SECURITY_EVENT_INCIDENT_DOORS,
  securityEventExportHead,
  securityEventSnapshot,
} from './security-event.js';

/** @internal Exact export carrier consumed by retrospective incident-scope tooling. */
export function securityEventExportEnvelope(): object {
  return {
    coverage: {
      doors: SECURITY_EVENT_INCIDENT_DOORS,
      schema: 'kovo-security-event-coverage/v1',
    },
    events: securityEventSnapshot(),
    head: securityEventExportHead(),
    schema: 'kovo-security-event-export/v2',
  };
}

/**
 * Export the bounded redacted journal only through the declared-egress door.
 * The MAC chain protects this exported/at-rest carrier; it is not a completeness claim.
 *
 * @internal
 */
export async function exportSecurityEvents(destination: string): Promise<Response> {
  return frameworkEgressFetch(destination, {
    body: canonicalJsonStringify(securityEventExportEnvelope()),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    redirect: 'error',
  });
}
