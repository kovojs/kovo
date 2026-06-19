/** @jsxImportSource @kovojs/server */
import { component, FieldError, form, FormError } from '@kovojs/core';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';
import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';

import { addToCart, type ProductGridResult } from '../domain.js';
import { productGridQuery } from '../queries.js';

const addToCartForm = form('cart/add');

const productGridStyles = style.create({
  errorText: {
    color: tokens.sys.color.error,
    fontSize: 14,
  },
  field: {
    backgroundColor: tokens.sys.color.surfaceContainerLowest,
    borderColor: tokens.sys.color.outline,
    borderRadius: tokens.sys.shape.cornerMedium,
    borderStyle: 'solid',
    borderWidth: 1,
    boxSizing: 'border-box',
    color: tokens.sys.color.onSurface,
    paddingBlock: 6,
    paddingInline: 10,
  },
  formLabel: {
    color: tokens.sys.color.onSurfaceVariant,
    display: 'grid',
    fontSize: 12,
    fontWeight: 500,
    gap: 4,
  },
  link: {
    color: tokens.sys.color.primary,
    fontSize: 14,
    fontWeight: 500,
    textDecoration: 'none',
  },
  panelError: {
    backgroundColor: tokens.sys.color.errorContainer,
    borderColor: tokens.sys.color.error,
    borderRadius: tokens.sys.shape.cornerMedium,
    borderStyle: 'solid',
    borderWidth: 1,
    color: tokens.sys.color.onErrorContainer,
    fontSize: 14,
    padding: 16,
  },
  productEmoji: {
    backgroundColor: tokens.sys.color.surfaceContainer,
    borderRadius: tokens.sys.shape.cornerMedium,
    display: 'grid',
    fontSize: 24,
    height: 48,
    placeItems: 'center',
    width: 48,
  },
  productForm: {
    alignItems: 'end',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  row: {
    alignItems: 'center',
    display: 'flex',
    gap: 16,
  },
  rowBetween: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'space-between',
  },
  stack: {
    display: 'grid',
    gap: 16,
  },
  stackSm: {
    display: 'grid',
    gap: 4,
  },
  tabularStrong: {
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
  },
  title: {
    color: tokens.sys.color.onSurface,
    fontWeight: 600,
    letterSpacing: 0,
    margin: 0,
  },
});

export const productGridStyleCss = style.emitAtomicCss(
  Object.values(productGridStyles).flatMap((entry) => entry.__rules ?? []),
);

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
    <section style={productGridStyles.panelError}>Products are temporarily unavailable.</section>
  );
}

export function renderProductGridItems(result: ProductGridResult): string {
  const cards = result.items.map((item) => renderProductCard(item));
  const cursor = result.nextCursor;
  return (
    <>
      {cards}
      {cursor ? (
        <a style={productGridStyles.link} href={`/products?after=${cursor}`} data-cursor={cursor}>
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
    <div style={productGridStyles.stack}>
      <div style={productGridStyles.row}>
        <span style={productGridStyles.productEmoji}>{item.emoji}</span>
        <div style={productGridStyles.stackSm}>
          <h2 style={productGridStyles.title}>{item.name}</h2>
          {Badge.definition.render({ variant: 'neutral', children: item.category })}
        </div>
      </div>
      <div style={productGridStyles.rowBetween}>
        <span style={productGridStyles.tabularStrong}>{priceLabel(item.unitPrice)}</span>
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
    <form enhance mutation={addToCart} key={item.id} style={productGridStyles.productForm}>
      <input type="hidden" name="productId" value={item.id} />
      <label style={productGridStyles.formLabel}>
        <span>Qty</span>
        <input
          style={productGridStyles.field}
          name="quantity"
          type="number"
          min="1"
          max={item.stock}
          value="1"
        />
        <FieldError name="quantity" style={productGridStyles.errorText} />
      </label>
      {Button.definition.render({
        children: soldOut ? 'Sold out' : 'Add to cart',
        disabled: soldOut,
        type: 'submit',
        variant: 'primary',
      })}
      <FormError
        code="OUT_OF_STOCK"
        style={productGridStyles.errorText}
        message={(failure: OutOfStockFailure) =>
          `Only ${failure.payload.availableQuantity} available.`
        }
      />
    </form>
  );
}
