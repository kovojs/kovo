/** @jsxImportSource @kovojs/server */
import { component, FieldError, form, FormError } from '@kovojs/core';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';

import { addToCart, type ProductGridResult } from '../domain.js';
import { productGridQuery } from '../queries.js';

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
      <section data-page-cursor={nextCursor ?? ''}>{renderProductGridItems(productGrid)}</section>
    );
  },
});

export function ProductGridError(): string {
  return renderProductGridError();
}

function renderProductGridError(): string {
  return (
    <section class="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
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
        <a href={`/products?after=${cursor}`} data-cursor={cursor}>
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
    <div class="grid gap-4">
      <div class="flex items-center gap-4">
        <span class="grid h-12 w-12 place-items-center rounded-md bg-slate-50 text-2xl">
          {item.emoji}
        </span>
        <div class="grid gap-1">
          <h2 class="font-semibold tracking-tight">{item.name}</h2>
          {Badge.definition.render({ variant: 'neutral', children: item.category })}
        </div>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-lg font-semibold tabular-nums">{priceLabel(item.unitPrice)}</span>
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
    <form enhance mutation={addToCart} key={item.id} class="flex flex-wrap items-end gap-2">
      <input type="hidden" name="productId" value={item.id} />
      <label class="grid gap-1 text-xs font-medium text-slate-700">
        <span>Qty</span>
        <input
          class="w-16 rounded-md border border-slate-300 px-2 py-1.5"
          name="quantity"
          type="number"
          min="1"
          max={item.stock}
          value="1"
        />
        <FieldError name="quantity" class="basis-full text-sm text-red-700" />
      </label>
      {Button.definition.render({
        children: soldOut ? 'Sold out' : 'Add to cart',
        disabled: soldOut,
        type: 'submit',
        variant: 'primary',
      })}
      <FormError
        code="OUT_OF_STOCK"
        class="basis-full text-sm text-red-700"
        message={(failure: OutOfStockFailure) =>
          `Only ${failure.payload.availableQuantity} available.`
        }
      />
    </form>
  );
}
