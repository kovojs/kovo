import { describe, expect, it } from 'vitest';

import { createSecurityEventCryptoHandle } from './crypto-authority.js';
import { EGRESS_BLOCKED_ERROR_NAME } from './egress.js';
import { exportSecurityEvents } from './security-event-export.js';
import {
  createSecurityEventJournal,
  installSecurityEventJournal,
  securityEvent,
  securityEventSnapshot,
} from './security-event.js';

describe('security-event export boundary (SPEC §§6.6, 11.2)', () => {
  it('keeps event payloads redacted and refuses export without the declared-egress door', async () => {
    const authority = createSecurityEventCryptoHandle(
      'security-event-export-test-secret-0123456789abcdef0123456789abcdef',
      'deployment:test',
    );
    installSecurityEventJournal(
      createSecurityEventJournal({ authority, now: () => 1_720_000_000_000 }),
    );
    securityEvent({ reason: 'invalid-token', type: 'csrf-rejected' });

    expect(Object.keys(securityEventSnapshot()[0]!).sort()).toEqual([
      'keyId',
      'mac',
      'occurredAt',
      'previousMac',
      'reason',
      'schema',
      'sequence',
      'type',
    ]);
    await expect(
      exportSecurityEvents('https://collector.example.test/v1/events'),
    ).rejects.toMatchObject({
      name: EGRESS_BLOCKED_ERROR_NAME,
      reason: 'missing-floor',
    });
  });
});
