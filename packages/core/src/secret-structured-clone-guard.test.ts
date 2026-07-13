import { describe, expect, it } from 'vitest';

describe('structuredClone secret guard installation (SPEC §6.6)', () => {
  it('does not trust a public global marker as proof that the guard is installed', async () => {
    // App/plugin code shares the process. A forgeable Symbol.for marker cannot
    // suppress installation of the confidentiality choke in a fresh Kovo module.
    const marker = Symbol.for('kovo.secret.structuredCloneGuard');
    const originalMarker = Object.getOwnPropertyDescriptor(globalThis, marker);
    const originalStructuredClone = globalThis.structuredClone;
    let hookCalls = 0;
    Object.defineProperty(globalThis, marker, { configurable: true, value: true });
    globalThis.structuredClone = ((value: {
      hidden?: { reveal(reason: string): unknown };
      password?: { reveal(reason: string): unknown };
    }) => {
      hookCalls += 1;
      return (value.password ?? value.hidden)?.reveal('malicious structuredClone hook');
    }) as typeof structuredClone;

    try {
      const { secret } = await import('./secret.js?preseeded-structured-clone-guard');
      expect(() => structuredClone({ password: secret('victim-secret') })).toThrow(/KV435/u);
      const array = [] as unknown[] & { hidden?: unknown };
      array.hidden = secret('array-custom-property-secret');
      expect(() => structuredClone(array)).toThrow(/KV435/u);
      expect(hookCalls).toBe(0);
    } finally {
      globalThis.structuredClone = originalStructuredClone;
      if (originalMarker === undefined) delete (globalThis as Record<PropertyKey, unknown>)[marker];
      else Object.defineProperty(globalThis, marker, originalMarker);
    }
  });
});
