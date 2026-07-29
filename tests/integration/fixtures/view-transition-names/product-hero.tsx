/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { trustedUrl } from '@kovojs/browser';

import type { ProductRecord } from './shared';

export const ProductHero = component({
  render: ({ product }: { product: ProductRecord }) => (
    <article>
      <img
        alt={product.imageAlt}
        data-transition="photo"
        src={trustedUrl(product.imageSrc, { reason: 'fixture-owned product hero image source' })}
        viewTransitionName="product-photo"
      />
      <h1 data-transition="title" viewTransitionName="product-title">
        {product.name}
      </h1>
    </article>
  ),
});
