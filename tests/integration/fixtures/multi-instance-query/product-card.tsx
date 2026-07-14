/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { productQuery, type ProductResult } from './shared';

interface ProductCardProps {
  productId: string;
}

// SPEC §9.1: the compiler owns each keyed card's reconstruction identity,
// query-instance args, attestation, and mutation-response authority.
export const ProductCard = component({
  props: { productId: String },
  queries: {
    product: productQuery.args((props: ProductCardProps) => ({ id: props.productId })),
  },
  render: ({ product, productId }: ProductCardProps & { product: ProductResult }) => (
    <product-card data-product-id={productId}>
      <h2>{product.name}</h2>
      <p>
        Stock <span>{product.stock}</span>
      </p>
    </product-card>
  ),
});
