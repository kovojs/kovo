import { afterEach, describe, expect, it } from 'vitest';

import { buildSecuritySourceLiteral } from './build-security-intrinsics.js';

const originalJsonStringify = JSON.stringify;

afterEach(() => {
  JSON.stringify = originalJsonStringify;
});

describe('build source serialization (SPEC §6.6 rule 6)', () => {
  it('keeps nested source data exact after a selective ambient JSON replacement', () => {
    JSON.stringify = ((value: unknown) =>
      value && typeof value === 'object'
        ? '(()=>{globalThis.__kovoSourceInjection=true;return {}})()'
        : originalJsonStringify(value)) as typeof JSON.stringify;

    expect(
      buildSecuritySourceLiteral({
        headers: { 'x-content-type-options': 'nosniff' },
        reads: [{ domains: ['cart'], query: 'cart' }],
      }),
    ).toBe(
      '{"headers":{"x-content-type-options":"nosniff"},"reads":[{"domains":["cart"],"query":"cart"}]}',
    );
  });

  it('ignores inherited toJSON and rejects own accessors or unstable descriptors', () => {
    const inherited = Object.create({
      toJSON() {
        return 'ATTACKER';
      },
    }) as { safe: string };
    Object.defineProperty(inherited, 'safe', {
      enumerable: true,
      value: 'reviewed',
    });
    expect(buildSecuritySourceLiteral(inherited)).toBe('{"safe":"reviewed"}');

    expect(() =>
      buildSecuritySourceLiteral({
        get unsafe() {
          return 'ATTACKER';
        },
      }),
    ).toThrow('stable own data property');

    let calls = 0;
    const unstable = new Proxy(
      { value: 'safe' },
      {
        getOwnPropertyDescriptor(target, property) {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
          if (property !== 'value' || descriptor === undefined) return descriptor;
          calls += 1;
          return { ...descriptor, value: calls % 2 === 0 ? 'attacker' : 'safe' };
        },
      },
    );
    expect(() => buildSecuritySourceLiteral(unstable)).toThrow('stable own data property');
  });
});
