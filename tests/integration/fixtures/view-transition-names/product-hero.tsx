/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import type { ProductRecord } from './shared';

export const ProductHero = component({
  render: ({ product }: { product: ProductRecord }) => (
    <article>
      <img
        alt={product.imageAlt}
        data-transition="photo"
        src={product.imageSrc}
        viewTransitionName="product-photo"
      />
      <h1 data-transition="title" viewTransitionName="product-title">
        {product.name}
      </h1>
    </article>
  ),
});
