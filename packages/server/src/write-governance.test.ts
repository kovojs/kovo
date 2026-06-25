import { describe, expect, it } from 'vitest';

import { adminAssign, drainAdminAssignFacts, serverValue } from './write-governance.js';

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

describe('adminAssign', () => {
  it('returns the value unchanged and records an audit fact', () => {
    drainAdminAssignFacts();
    const value = 'superadmin';
    expect(adminAssign(value, 'role grant by admin')).toBe(value);
    const facts = drainAdminAssignFacts();
    expect(facts).toEqual([{ reason: 'role grant by admin' }]);
    // Draining clears the log.
    expect(drainAdminAssignFacts()).toEqual([]);
  });

  it('requires a non-empty reason', () => {
    expect(() => adminAssign('x', '')).toThrow(/reason/);
  });

  it('records structured audit context when provided', () => {
    drainAdminAssignFacts();
    adminAssign('admin', {
      actor: 'user:1',
      callsite: 'account.domain.ts:12',
      columns: ['role'],
      producer: 'account.updateRole',
      reason: 'role grant by admin',
      session: 'session:1',
      sourceProvenance: 'input.role',
      table: 'accounts',
    });

    expect(drainAdminAssignFacts()).toEqual([
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
