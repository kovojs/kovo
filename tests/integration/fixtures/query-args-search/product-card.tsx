/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { productQuery, type ProductResult } from './shared';

export const ProductCard = component({
  queries: {
    product: productQuery.args(() => ({ id: 'p1', max: 200 })),
  },
  render: ({ product }: { product: ProductResult }) => (
    <product-card>
      <p data-product>
        {product.id}:{product.name}:{String(product.withinBudget)}
      </p>
    </product-card>
  ),
});
