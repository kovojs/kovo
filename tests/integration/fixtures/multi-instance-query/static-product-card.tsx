/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { productQuery, type ProductResult } from './shared';

interface StaticProductCardProps {
  productId: string;
}

// This second keyed instance remains a generated query-plan consumer, but it is
// intentionally not a mutation-response target. The test can therefore prove a
// p1-scoped generated response never morphs or rewrites the p2 instance.
export const StaticProductCard = component({
  disableServerRefresh: true,
  props: { productId: String },
  queries: {
    product: productQuery.args((props: StaticProductCardProps) => ({ id: props.productId })),
  },
  render: ({ product, productId }: StaticProductCardProps & { product: ProductResult }) => (
    <product-card data-product-id={productId}>
      <h2>{product.name}</h2>
      <p>
        Stock <span>{product.stock}</span>
      </p>
    </product-card>
  ),
});
