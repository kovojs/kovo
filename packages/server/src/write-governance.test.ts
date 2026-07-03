import { describe, expect, it } from 'vitest';

import { trustedAssign, drainTrustedAssignFacts, serverValue } from './write-governance.js';

// SPEC §10.3/§11.1 — the KV438 mass-assignment runtime escapes (author-assertion,
// audit-grade per SPEC §6.6). Runtime-transparent value passthrough.

describe('serverValue', () => {
  it('returns the value unchanged', () => {
    const value = { a: 1 };
    expect(serverValue(value, 'server-derived')).toBe(value);
    expect(serverValue('admin', 'seed role')).toBe('admin');
  });

  it('requires a non-empty reason', () => {
    expect(() => serverValue('x', '')).toThrow(/reason/);
    expect(() => serverValue('x', '   ')).toThrow(/reason/);
  });
});

describe('trustedAssign', () => {
  it('returns the value unchanged and records an audit fact', () => {
    drainTrustedAssignFacts();
    const value = 'superadmin';
    expect(trustedAssign(value, 'role grant by admin')).toBe(value);
    const facts = drainTrustedAssignFacts();
    expect(facts).toEqual([{ reason: 'role grant by admin' }]);
    // Draining clears the log.
    expect(drainTrustedAssignFacts()).toEqual([]);
  });

  it('requires a non-empty reason', () => {
    expect(() => trustedAssign('x', '')).toThrow(/reason/);
  });

  it('records structured audit context when provided', () => {
    drainTrustedAssignFacts();
    trustedAssign('admin', {
      actor: 'user:1',
      callsite: 'account.domain.ts:12',
      columns: ['role'],
      producer: 'account.updateRole',
      reason: 'role grant by admin',
      session: 'session:1',
      sourceProvenance: 'input.role',
      table: 'accounts',
    });

    expect(drainTrustedAssignFacts()).toEqual([
      {
        actor: 'user:1',
        callsite: 'account.domain.ts:12',
        columns: ['role'],
        producer: 'account.updateRole',
        reason: 'role grant by admin',
        session: 'session:1',
        sourceProvenance: 'input.role',
        table: 'accounts',
      },
    ]);
  });
});
