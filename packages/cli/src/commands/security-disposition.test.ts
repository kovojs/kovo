import { describe, expect, it } from 'vitest';

import { snapshotKovoInvocationEnvironment } from './security-disposition.js';

describe('CLI invocation environment authority (SPEC §6.6 rule 6)', () => {
  it('copies only own values into an immutable null-prototype snapshot', () => {
    const source = { OPERATOR_VALUE: 'pinned' } as NodeJS.ProcessEnv;
    const snapshot = snapshotKovoInvocationEnvironment(source);

    Object.defineProperty(Object.prototype, 'KOVO_PRESET', {
      configurable: true,
      value: 'cloudflare',
    });
    Object.defineProperty(Object.prototype, 'KOVO_ADMIN_DATABASE_URL', {
      configurable: true,
      value: 'postgres://attacker@127.0.0.1:2/attacker',
    });
    try {
      expect(Object.getPrototypeOf(snapshot)).toBeNull();
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(snapshot.OPERATOR_VALUE).toBe('pinned');
      expect(snapshot.KOVO_PRESET).toBeUndefined();
      expect(snapshot.KOVO_ADMIN_DATABASE_URL).toBeUndefined();
    } finally {
      delete (Object.prototype as Record<string, unknown>).KOVO_PRESET;
      delete (Object.prototype as Record<string, unknown>).KOVO_ADMIN_DATABASE_URL;
    }
  });

  it('rejects accessor-backed and unstable environment values', () => {
    const accessor = Object.create(null) as NodeJS.ProcessEnv;
    Object.defineProperty(accessor, 'KOVO_PRESET', {
      enumerable: true,
      get: () => 'vercel',
    });
    expect(() => snapshotKovoInvocationEnvironment(accessor)).toThrow(/changed while|own string/u);

    let descriptorReads = 0;
    const unstable = new Proxy({ KOVO_PRESET: 'node' } as NodeJS.ProcessEnv, {
      getOwnPropertyDescriptor(_target, property) {
        descriptorReads += 1;
        return {
          configurable: true,
          enumerable: true,
          value: descriptorReads % 2 === 0 ? 'node' : 'vercel',
          writable: true,
        };
      },
    });
    expect(() => snapshotKovoInvocationEnvironment(unstable)).toThrow(/changed while/u);
  });
});
