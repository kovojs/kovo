import { describe, expect, it } from 'vitest';

import { deriveRegistryIdentity } from './registry-identities.js';

describe('deriveRegistryIdentity', () => {
  it('derives module-relative registry keys from exported bindings', () => {
    expect(
      deriveRegistryIdentity('/repo/apps/shop/src/features/cart/actions.ts', 'addToCart'),
    ).toEqual({ key: 'features/cart/actions/add-to-cart' });
  });

  it('uses the integration fixture root like component registry keys', () => {
    expect(
      deriveRegistryIdentity(
        '/repo/tests/integration/fixtures/basic/src/server/queries.ts',
        'productDetail',
      ),
    ).toEqual({ key: 'basic/src/server/queries/product-detail' });
  });

  it('falls back to the full normalized path when no known source root is present', () => {
    expect(deriveRegistryIdentity('server/queries.ts', 'CartQuery')).toEqual({
      key: 'server/queries/cart-query',
    });
  });
});
