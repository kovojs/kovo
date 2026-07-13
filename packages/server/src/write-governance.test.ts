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

  it('keeps reason validation pinned against late String.prototype.trim poisoning', () => {
    const nativeTrim = String.prototype.trim;
    try {
      String.prototype.trim = () => 'forged non-empty reason';
      expect(() => serverValue('x', '')).toThrow(/reason/);
      expect(() => trustedAssign('x', '')).toThrow(/reason/);
      expect(() => trustedAssign('x', { reason: '' })).toThrow(/reason/);
      expect(serverValue('x', 'server generated')).toBe('x');
      expect(trustedAssign('x', 'operator grant')).toBe('x');
    } finally {
      String.prototype.trim = nativeTrim;
      drainTrustedAssignFacts();
    }
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

  it('requires structured audit context to use stable own data properties', () => {
    drainTrustedAssignFacts();
    const inherited = Object.create({
      columns: ['role'],
      reason: 'prototype-provided role grant',
    });
    expect(() => trustedAssign('admin', inherited)).toThrow('own data property');
    expect(drainTrustedAssignFacts()).toEqual([]);

    let getterCalls = 0;
    const accessor = {} as { reason: string };
    Object.defineProperty(accessor, 'reason', {
      configurable: true,
      get() {
        getterCalls += 1;
        return 'accessor-provided role grant';
      },
    });
    expect(() => trustedAssign('admin', accessor)).toThrow('own data property');
    expect(getterCalls).toBe(0);
    expect(drainTrustedAssignFacts()).toEqual([]);
  });

  it('retains an immutable exact snapshot of structured audit context', () => {
    drainTrustedAssignFacts();
    const options = {
      actor: 'user:1',
      columns: ['role'],
      reason: 'role grant by admin',
    };
    trustedAssign('admin', options);
    options.actor = 'attacker';
    options.columns[0] = 'ownerId';
    options.reason = 'changed after privileged assignment';

    const [fact] = drainTrustedAssignFacts();
    expect(fact).toEqual({
      actor: 'user:1',
      columns: ['role'],
      reason: 'role grant by admin',
    });
    expect(Object.getPrototypeOf(fact)).toBeNull();
    expect(Object.isFrozen(fact)).toBe(true);
    expect(Object.isFrozen(fact?.columns)).toBe(true);
  });

  it('bounds structured audit columns before traversal', () => {
    const oversized = new Array(100_001).fill('role');
    expect(() =>
      trustedAssign('admin', {
        columns: oversized,
        reason: 'role grant by admin',
      }),
    ).toThrow('dense array');
  });
});
