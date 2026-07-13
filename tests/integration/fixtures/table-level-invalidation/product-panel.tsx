/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { productQuery, type ProductPanelResult } from './shared';

interface ProductPanelProps {
  label: string;
  productId: string;
}

export const ProductPanel = component({
  props: { label: String, productId: String },
  queries: {
    product: productQuery.args((props: ProductPanelProps) => props),
  },
  render: ({ product, productId }: ProductPanelProps & { product: ProductPanelResult }) => (
    <section data-product-id={productId}>
      <h2>{product.label}</h2>
      <output>{product.stock}</output>
    </section>
  ),
});
