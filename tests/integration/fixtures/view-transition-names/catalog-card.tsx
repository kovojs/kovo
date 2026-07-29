/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { trustedUrl } from '@kovojs/browser';

import type { ProductRecord } from './shared';

export const CatalogCard = component({
  render: ({ product }: { product: ProductRecord }) => (
    <article>
      <a href={`/products/${product.id}`} id="product-link">
        <img
          alt={product.imageAlt}
          data-transition="photo"
          src={trustedUrl(product.imageSrc, { reason: 'fixture-owned catalog image source' })}
          viewTransitionName="product-photo"
        />
        <h2 data-transition="title" viewTransitionName="product-title">
          {product.name}
        </h2>
      </a>
    </article>
  ),
});
