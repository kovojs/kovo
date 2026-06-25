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

  it('requires the active build token for versioned client modules', () => {
    expect(
      isAllowedKovoDynamicImportUrl('/c/__v/cart-v1/cart.client.js', { buildToken: 'cart-v1' }),
    ).toBe(true);
    expect(
      isAllowedKovoDynamicImportUrl('/c/__v/old/cart.client.js', { buildToken: 'cart-v1' }),
    ).toBe(false);
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
