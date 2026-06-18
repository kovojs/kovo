// @kovojs-ir — lowered from examples/commerce/src/components/product-grid.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
import { component, FieldError, form, FormError } from '@kovojs/core';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';
import * as style from '@kovojs/style';

import { addToCart, type ProductGridResult } from '../domain.js';
import { productGridQuery } from '../queries.js';
import { commerceStyles } from '../styles.js';
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';


const addToCartForm = form('cart/add');

export interface OutOfStockFailure {
  code: 'OUT_OF_STOCK';
  payload: { availableQuantity: number };
}

export const ProductGrid = component({
  errorBoundary: {
    fallback: renderProductGridError,
    target: 'product-grid',
  },
  mutations: { addToCart: addToCartForm },
  queries: { productGrid: productGridQuery },
  render: ({ productGrid }: { productGrid: ProductGridResult }) => {
    const { nextCursor } = productGrid;
    return (
      <section data-page-cursor={nextCursor ?? ''} kovo-c="product-grid" kovo-deps="productGrid" kovo-fragment-target="product-grid" kovo-live-component="components/product-grid/product-grid">{renderProductGridItems(productGrid)}</section>
    );
  },
});
ProductGrid.name = "components/product-grid/product-grid";

export function ProductGridError(): string {
  return renderProductGridError();
}

function renderProductGridError(): string {
  return (
    <section {...style.attrs(commerceStyles.panelError)}>
      Products are temporarily unavailable.
    </section>
  );
}

export function renderProductGridItems(result: ProductGridResult): string {
  const cards = result.items.map((item) => renderProductCard(item));
  const cursor = result.nextCursor;
  return (
    <>
      {cards}
      {cursor ? (
        <a {...style.attrs(commerceStyles.productLink)} href={`/products?after=${cursor}`} data-cursor={cursor}>
          More
        </a>
      ) : (
        ''
      )}
    </>
  );
}

export interface ProductItem {
  id: string;
  name: string;
  category: string;
  emoji: string;
  stock: number;
  unitPrice: number;
}

/** Format an integer cent amount as `$25.99`. */
export function priceLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Low stock reads as a warning badge; healthy stock as success. */
function stockBadge(stock: number): string {
  if (stock === 0) return Badge.definition.render({ variant: 'warning', children: 'Sold out' });
  if (stock <= 2)
    return Badge.definition.render({ variant: 'warning', children: `Only ${stock} left` });
  return Badge.definition.render({ variant: 'success', children: `${stock} in stock` });
}

function renderProductCard(item: ProductItem): string {
  const body = (
    <div {...style.attrs(commerceStyles.stack)}>
      <div {...style.attrs(commerceStyles.row)}>
        <span {...style.attrs(commerceStyles.productEmoji)}>{escapeText(item.emoji)}</span>
        <div {...style.attrs(commerceStyles.stackSm)}>
          <h2 {...style.attrs(commerceStyles.title)}>{escapeText(item.name)}</h2>
          {Badge.definition.render({ variant: 'neutral', children: item.category })}
        </div>
      </div>
      <div {...style.attrs(commerceStyles.rowBetween)}>
        <span {...style.attrs(commerceStyles.tabularStrong)}>{priceLabel(item.unitPrice)}</span>
        {stockBadge(item.stock)}
      </div>
      {renderAddToCartForm(item)}
    </div>
  );
  return <article kovo-key={item.id}>{Card.definition.render({ children: body })}</article>;
}

export function renderAddToCartForm(item: { id: string; stock: number }): string {
  const soldOut = item.stock === 0;
  return (
    <form enhance mutation={addToCart} method="post" action="/_m/cart/add" data-mutation="cart/add" kovo-fragment-target={`add-to-cart:${item.id}`} kovo-key={item.id} {...style.attrs(commerceStyles.productForm)}>
      <input type="hidden" name="productId" value={item.id} />
      <label {...style.attrs(commerceStyles.formLabel)}>
        <span>Qty</span>
        <input
          {...style.attrs(commerceStyles.field)}
          name="quantity"
          type="number"
          min="1"
          max={item.stock}
          value="1"
        />
        <FieldError name="quantity" {...style.attrs(commerceStyles.errorText)} />
      </label>
      {Button.definition.render({
        children: soldOut ? 'Sold out' : 'Add to cart',
        disabled: soldOut,
        type: 'submit',
        variant: 'primary',
      })}
      <FormError
        code="OUT_OF_STOCK"
        {...style.attrs(commerceStyles.errorText)}
        message={(failure: OutOfStockFailure) =>
          `Only ${failure.payload.availableQuantity} available.`
        }
      />
    </form>
  );
}

export const ProductGrid$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: ProductGrid,
  componentId: "components/product-grid/product-grid",
}));
