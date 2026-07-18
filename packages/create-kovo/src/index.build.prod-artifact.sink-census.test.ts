import { boundaryCrossingSinkInventory } from '@kovojs/core/internal/source-sink-registry';
import { describe, expect, it } from 'vitest';

describe('prod artifact sink census inventory evidence', () => {
  it('consumes the single C9 inventory and requires live hostile-value proof for every row', () => {
    const entries = boundaryCrossingSinkInventory();

    expect(entries.map((entry) => entry.sink)).toEqual([
      'db driver statement',
      'http response body',
      'http response headers',
      'redirect URL',
      'Set-Cookie',
      'blob/file write',
      'durable-task payload',
      'request method/authority/scheme',
      'webhook payload',
      'HTML/render output',
      'log/error output',
      'outbound egress request',
      'authorization principal/data access',
      'Better Auth credential/non-egress',
      'dynamic module/process execution',
    ]);
    for (const entry of entries) {
      expect(entry.owner, entry.sink).not.toBe('');
      expect(entry.proofGate, entry.sink).not.toBe('');
      expect(entry.hostileValueEvidence.length, entry.sink).toBeGreaterThan(0);
    }
  });
});
