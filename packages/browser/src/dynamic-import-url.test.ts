import { describe, expect, it } from 'vitest';

import {
  assertAllowedKovoDynamicImportUrl,
  isAllowedKovoDynamicImportUrl,
} from './dynamic-import-url.js';

describe('Kovo dynamic import URL guard', () => {
  it('rejects URLs outside same-origin Kovo client modules', () => {
    expect(isAllowedKovoDynamicImportUrl('data:text/javascript,export{}')).toBe(false);
    expect(isAllowedKovoDynamicImportUrl('https://cdn.example.test/c/cart.client.js')).toBe(false);
    expect(isAllowedKovoDynamicImportUrl('/assets/cart.js')).toBe(false);
  });

  it('allows same-origin source modules only on local dev origins', () => {
    expect(isAllowedKovoDynamicImportUrl('/client.ts')).toBe(true);
    expect(isAllowedKovoDynamicImportUrl('/state-actions.ts?import')).toBe(true);

    const location = globalThis.location;
    Reflect.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { href: 'https://shop.example.test/', origin: 'https://shop.example.test' },
    });
    try {
      expect(isAllowedKovoDynamicImportUrl('/client.ts')).toBe(false);
    } finally {
      Reflect.defineProperty(globalThis, 'location', {
        configurable: true,
        value: location,
      });
    }
  });

  it('allows retained same-origin versioned client modules across build tokens', () => {
    expect(
      isAllowedKovoDynamicImportUrl('/c/__v/cart-v1/cart.client.js', { buildToken: 'cart-v1' }),
    ).toBe(true);
    expect(
      isAllowedKovoDynamicImportUrl('/c/__v/old/cart.client.js', { buildToken: 'cart-v1' }),
    ).toBe(true);
  });

  it('requires manifest membership when a compiler-emitted allowlist is present', () => {
    const options = {
      allowedModuleUrls: ['/c/__v/cart-v1/cart.client.js', '/c/__v/cart-v1/panel.client.js?hash=1'],
      buildToken: 'cart-v1',
    };

    expect(isAllowedKovoDynamicImportUrl('/c/__v/cart-v1/cart.client.js', options)).toBe(true);
    expect(isAllowedKovoDynamicImportUrl('/c/__v/cart-v1/panel.client.js?hash=1', options)).toBe(
      true,
    );
    expect(isAllowedKovoDynamicImportUrl('/c/__v/cart-v1/secret.client.js', options)).toBe(false);
    expect(isAllowedKovoDynamicImportUrl('/c/__v/cart-v1/panel.client.js?hash=2', options)).toBe(
      false,
    );
  });

  it('fails closed before import when a manifest-listed build URL is missing', () => {
    expect(() =>
      assertAllowedKovoDynamicImportUrl('/c/__v/cart-v1/secret.client.js', {
        allowedModuleUrls: ['/c/__v/cart-v1/cart.client.js'],
        buildToken: 'cart-v1',
      }),
    ).toThrow('Disallowed Kovo dynamic import URL: /c/__v/cart-v1/secret.client.js');
  });
});
