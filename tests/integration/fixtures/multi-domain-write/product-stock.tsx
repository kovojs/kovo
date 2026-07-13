/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { productQuery, type ProductStockResult } from './shared';

export const ProductStock = component({
  queries: { product: productQuery },
  render: ({ product }: { product: ProductStockResult }) => (
    <p data-testid="product-stock">{product.stock}</p>
  ),
});
