import { describe, expect, it } from 'vitest';

import {
  trustedAssign,
  drainTrustedAssignFacts,
  serverValue,
  type TrustedAssignObligation,
} from './write-governance.js';

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
      expect(serverValue('x', 'server generated')).toBe('x');
    } finally {
      String.prototype.trim = nativeTrim;
      drainTrustedAssignFacts();
    }
  });
});

describe('trustedAssign', () => {
  it('rejects prose laundering and requires a structured governed-write obligation', () => {
    expect(() => trustedAssign('admin', 'role grant by admin' as never)).toThrow(
      /structured obligation/u,
    );

    expect(
      trustedAssign('admin', {
        evidence: {
          digest: `sha256:${'a'.repeat(64)}`,
          kind: 'test',
          reference: 'tests/authz/admin-role-grant',
        },
        invariant: 'governed-write.authorized-principal',
        why: { guard: 'guards.role:admin', kind: 'guard-chain' },
      }),
    ).toBe('admin');
    expect(drainTrustedAssignFacts()).toEqual([
      {
        obligation: {
          evidence: {
            digest: `sha256:${'a'.repeat(64)}`,
            kind: 'test',
            reference: 'tests/authz/admin-role-grant',
          },
          invariant: 'governed-write.authorized-principal',
          why: { guard: 'guards.role:admin', kind: 'guard-chain' },
        },
      },
    ]);
  });

  it('returns the value unchanged and records the exact obligation', () => {
    drainTrustedAssignFacts();
    const value = 'superadmin';
    expect(trustedAssign(value, obligation())).toBe(value);
    const facts = drainTrustedAssignFacts();
    expect(facts).toEqual([{ obligation: obligation() }]);
    // Draining clears the log.
    expect(drainTrustedAssignFacts()).toEqual([]);
  });

  it('requires structured obligations to use stable own data properties', () => {
    drainTrustedAssignFacts();
    const inherited = Object.create(obligation()) as TrustedAssignObligation;
    expect(() => trustedAssign('admin', inherited)).toThrow(/contain exactly|own data property/u);
    expect(drainTrustedAssignFacts()).toEqual([]);

    let getterCalls = 0;
    const accessor = {
      evidence: obligation().evidence,
      why: obligation().why,
    } as unknown as TrustedAssignObligation;
    Object.defineProperty(accessor, 'invariant', {
      configurable: true,
      get() {
        getterCalls += 1;
        return 'governed-write.authorized-principal';
      },
    });
    expect(() => trustedAssign('admin', accessor)).toThrow('own data property');
    expect(getterCalls).toBe(0);
    expect(drainTrustedAssignFacts()).toEqual([]);
  });

  it('retains an immutable exact snapshot of the structured obligation', () => {
    drainTrustedAssignFacts();
    const options = obligation();
    trustedAssign('admin', options);
    options.evidence.reference = 'attacker';
    if (options.why.kind === 'guard-chain') options.why.guard = 'guards.public';

    const [fact] = drainTrustedAssignFacts();
    expect(fact).toEqual({ obligation: obligation() });
    expect(Object.getPrototypeOf(fact)).toBeNull();
    expect(Object.isFrozen(fact)).toBe(true);
    expect(Object.isFrozen(fact?.obligation)).toBe(true);
    expect(Object.isFrozen(fact?.obligation.evidence)).toBe(true);
    expect(Object.isFrozen(fact?.obligation.why)).toBe(true);
  });

  it('rejects prose-like references, malformed digests, and surplus fields', () => {
    expect(() =>
      trustedAssign('admin', {
        ...obligation(),
        evidence: { ...obligation().evidence, reference: 'this is prose' },
      }),
    ).toThrow('machine-readable');
    expect(() =>
      trustedAssign('admin', {
        ...obligation(),
        evidence: { ...obligation().evidence, digest: 'sha256:nope' as `sha256:${string}` },
      }),
    ).toThrow('sha256');
    expect(() =>
      trustedAssign('admin', { ...obligation(), reason: 'laundered prose' } as never),
    ).toThrow(/exactly/u);
  });
});

function obligation(): {
  evidence: { digest: `sha256:${string}`; kind: 'test'; reference: string };
  invariant: 'governed-write.authorized-principal';
  why: { guard: string; kind: 'guard-chain' };
} {
  return {
    evidence: {
      digest: `sha256:${'a'.repeat(64)}`,
      kind: 'test',
      reference: 'tests/authz/admin-role-grant',
    },
    invariant: 'governed-write.authorized-principal',
    why: { guard: 'guards.role:admin', kind: 'guard-chain' },
  };
}
