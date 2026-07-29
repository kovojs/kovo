/** @jsxImportSource @kovojs/server */
import { component, FieldError, FormError } from '@kovojs/core';
import * as style from '@kovojs/style';

import { addToCart, type ProductGridResult } from '../domain.js';
import { productGridQuery } from '../queries.js';

const productGridStyles = style.create({
  authPrompt: {
    color: style.tokens.sys.color.onSurfaceVariant,
    display: 'grid',
    gap: 8,
  },
  authPromptLink: {
    color: style.tokens.sys.color.primary,
    fontSize: 14,
    fontWeight: 500,
    textDecoration: 'none',
  },
  badge: {
    borderRadius: style.tokens.sys.shape.cornerFull,
    display: 'inline-flex',
    fontSize: 12,
    fontWeight: 600,
    paddingBlock: 2,
    paddingInline: 8,
    width: 'fit-content',
  },
  badgeNeutral: {
    backgroundColor: style.tokens.sys.color.surfaceContainer,
    color: style.tokens.sys.color.onSurfaceVariant,
  },
  badgeSuccess: {
    backgroundColor: style.tokens.sys.color.primaryContainer,
    color: style.tokens.sys.color.onPrimaryContainer,
  },
  badgeWarning: {
    backgroundColor: style.tokens.sys.color.errorContainer,
    color: style.tokens.sys.color.onErrorContainer,
  },
  button: {
    backgroundColor: style.tokens.sys.color.primary,
    border: 0,
    borderRadius: style.tokens.sys.shape.cornerMedium,
    color: style.tokens.sys.color.onPrimary,
    fontWeight: 600,
    paddingBlock: 8,
    paddingInline: 14,
  },
  card: {
    backgroundColor: style.tokens.sys.color.surfaceContainerLowest,
    borderColor: style.tokens.sys.color.outlineVariant,
    borderRadius: style.tokens.sys.shape.cornerLarge,
    borderStyle: 'solid',
    borderWidth: 1,
    padding: 16,
  },
  errorText: {
    color: style.tokens.sys.color.error,
    fontSize: 14,
  },
  field: {
    backgroundColor: style.tokens.sys.color.surfaceContainerLowest,
    borderColor: style.tokens.sys.color.outline,
    borderRadius: style.tokens.sys.shape.cornerMedium,
    borderStyle: 'solid',
    borderWidth: 1,
    boxSizing: 'border-box',
    color: style.tokens.sys.color.onSurface,
    paddingBlock: 6,
    paddingInline: 10,
  },
  formLabel: {
    color: style.tokens.sys.color.onSurfaceVariant,
    display: 'grid',
    fontSize: 12,
    fontWeight: 500,
    gap: 4,
  },
  link: {
    color: style.tokens.sys.color.primary,
    fontSize: 14,
    fontWeight: 500,
    textDecoration: 'none',
  },
  panelError: {
    backgroundColor: style.tokens.sys.color.errorContainer,
    borderColor: style.tokens.sys.color.error,
    borderRadius: style.tokens.sys.shape.cornerMedium,
    borderStyle: 'solid',
    borderWidth: 1,
    color: style.tokens.sys.color.onErrorContainer,
    fontSize: 14,
    padding: 16,
  },
  productEmoji: {
    backgroundColor: style.tokens.sys.color.surfaceContainer,
    borderRadius: style.tokens.sys.shape.cornerMedium,
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
    color: style.tokens.sys.color.onSurface,
    fontWeight: 600,
    letterSpacing: 0,
    margin: 0,
  },
});

export interface OutOfStockFailure {
  code: 'OUT_OF_STOCK';
  payload: { availableQuantity: number };
}

export const ProductGrid = component({
  errorBoundary: {
    fallback: renderProductGridError,
    target: 'product-grid',
  },
  mutations: { addToCart },
  queries: { productGrid: productGridQuery },
  render: ({ productGrid }: { productGrid: ProductGridResult }) => {
    const { nextCursor } = productGrid;
    return (
      <section data-page-cursor={nextCursor ?? ''}>{renderProductGridItems(productGrid)}</section>
    );
  },
});

export const GuestProductGrid = component({
  errorBoundary: {
    fallback: renderProductGridError,
    target: 'product-grid',
  },
  queries: { productGrid: productGridQuery },
  render: ({ productGrid }: { productGrid: ProductGridResult }) => (
    <section data-page-cursor={productGrid.nextCursor ?? ''}>
      {renderProductGridItems(productGrid, false)}
    </section>
  ),
});

export function ProductGridError() {
  return renderProductGridError();
}

function renderProductGridError() {
  return (
    <section style={productGridStyles.panelError}>Products are temporarily unavailable.</section>
  );
}

export function renderProductGridItems(result: ProductGridResult, signedIn = true) {
  const cards = result.items.map((item) => renderProductCard(item, signedIn));
  return <>{cards}</>;
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
function stockBadge(stock: number) {
  if (stock === 0)
    return <span style={[productGridStyles.badge, productGridStyles.badgeWarning]}>Sold out</span>;
  if (stock <= 2)
    return (
      <span style={[productGridStyles.badge, productGridStyles.badgeWarning]}>
        Only {stock} left
      </span>
    );
  return (
    <span style={[productGridStyles.badge, productGridStyles.badgeSuccess]}>
      {stock} in stock
    </span>
  );
}

function renderProductCard(item: ProductItem, signedIn: boolean) {
  const body = (
    <div style={productGridStyles.stack}>
      <div style={productGridStyles.row}>
        <span style={productGridStyles.productEmoji}>{item.emoji}</span>
        <div style={productGridStyles.stackSm}>
          <h2 style={productGridStyles.title}>{item.name}</h2>
          <span style={[productGridStyles.badge, productGridStyles.badgeNeutral]}>
            {item.category}
          </span>
        </div>
      </div>
      <div style={productGridStyles.rowBetween}>
        <span style={productGridStyles.tabularStrong}>{priceLabel(item.unitPrice)}</span>
        {stockBadge(item.stock)}
      </div>
      {renderAddToCartForm(item, signedIn)}
    </div>
  );
  return (
    <article key={item.id}>
      <section style={productGridStyles.card}>{body}</section>
    </article>
  );
}

export function renderAddToCartForm(item: { id: string; stock: number }, signedIn = true) {
  if (!signedIn) {
    return (
      <div style={productGridStyles.authPrompt}>
        <span>Sign in to add items to the demo cart.</span>
        <a style={productGridStyles.authPromptLink} href="/login?next=%2Fcart">
          Sign in
        </a>
      </div>
    );
  }
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
      <button disabled={soldOut} style={productGridStyles.button} type="submit">
        {soldOut ? 'Sold out' : 'Add to cart'}
      </button>
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
