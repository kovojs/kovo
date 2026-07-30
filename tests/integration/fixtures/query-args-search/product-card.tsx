/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { productQuery, type ProductResult } from './shared';

interface ProductCardProps {
  id: string;
  max: number;
}

export const ProductCard = component({
  props: { id: String, max: Number },
  queries: {
    product: productQuery.args((props: ProductCardProps) => props),
  },
  render: ({ product }: ProductCardProps & { product: ProductResult }) => (
    <product-card>
      <p data-product>
        {product.id}:{product.name}:{String(product.withinBudget)}
      </p>
    </product-card>
  ),
});
