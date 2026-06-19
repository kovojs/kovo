// @kovojs-ir — lowered from examples/commerce/src/components/product-grid.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
import { component, FieldError, form, FormError } from '@kovojs/core';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';
import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';

import { addToCart, type ProductGridResult } from '../domain.js';
import { productGridQuery } from '../queries.js';
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';


const addToCartForm = form('cart/add');

const productGridStyles = style.create(
  {
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
  }
);

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
    <section class="kv-product-grid-bg-1ovdb1 kv-product-grid-bd-7kjy5v kv-product-grid-bd-cxmz9t kv-product-grid-bd-20shz8 kv-product-grid-bd-ycquvh kv-product-grid-fg-1jhvxd kv-product-grid-font-1dmql4 kv-product-grid-pad-zcqjwv" data-style-src="examples/commerce/src/components/product-grid.tsx#panelError">Products are temporarily unavailable.</section>
  );
}

export function renderProductGridItems(result: ProductGridResult): string {
  const cards = result.items.map((item) => renderProductCard(item));
  const cursor = result.nextCursor;
  return (
    <>
      {cards}
      {cursor ? (
        <a class="kv-product-grid-fg-p4cbfq kv-product-grid-font-1dmql4 kv-product-grid-font-1riwsq kv-product-grid-text-5zwurx" data-style-src="examples/commerce/src/components/product-grid.tsx#link" href={`/products?after=${cursor}`} data-cursor={cursor}>
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
    <div class="kv-product-grid-d-zbwzwb kv-product-grid-gap-vivniy" data-style-src="examples/commerce/src/components/product-grid.tsx#stack">
      <div class="kv-product-grid-align-kr7kq4 kv-product-grid-d-1upqo3 kv-product-grid-gap-vivniy" data-style-src="examples/commerce/src/components/product-grid.tsx#row">
        <span class="kv-product-grid-bg-msu64p kv-product-grid-bd-cxmz9t kv-product-grid-d-zbwzwb kv-product-grid-font-14cref kv-product-grid-h-1emdn3 kv-product-grid-place-1lop9p kv-product-grid-w-bygggi" data-style-src="examples/commerce/src/components/product-grid.tsx#productEmoji">{escapeText(item.emoji)}</span>
        <div class="kv-product-grid-d-zbwzwb kv-product-grid-gap-18yvcf" data-style-src="examples/commerce/src/components/product-grid.tsx#stackSm">
          <h2 class="kv-product-grid-fg-gtinz5 kv-product-grid-font-1bl9ee kv-product-grid-letter-1yuj1e kv-product-grid-m-1m87zi" data-style-src="examples/commerce/src/components/product-grid.tsx#title">{escapeText(item.name)}</h2>
          {Badge.definition.render({ variant: 'neutral', children: item.category })}
        </div>
      </div>
      <div class="kv-product-grid-align-kr7kq4 kv-product-grid-d-1upqo3 kv-product-grid-justify-m1htsu" data-style-src="examples/commerce/src/components/product-grid.tsx#rowBetween">
        <span class="kv-product-grid-font-4v1il5 kv-product-grid-font-1bl9ee" data-style-src="examples/commerce/src/components/product-grid.tsx#tabularStrong">{priceLabel(item.unitPrice)}</span>
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
    <form enhance mutation={addToCart} method="post" action="/_m/cart/add" data-mutation="cart/add" kovo-fragment-target={`add-to-cart:${item.id}`} kovo-key={item.id} class="kv-product-grid-align-1gebhx kv-product-grid-d-1upqo3 kv-product-grid-flex-1yw3ta kv-product-grid-gap-1og9b5" data-style-src="examples/commerce/src/components/product-grid.tsx#productForm">
      <input type="hidden" name="productId" value={item.id} />
      <label class="kv-product-grid-fg-emqj71 kv-product-grid-d-zbwzwb kv-product-grid-font-1b3epb kv-product-grid-font-1riwsq kv-product-grid-gap-18yvcf" data-style-src="examples/commerce/src/components/product-grid.tsx#formLabel">
        <span>Qty</span>
        <input
          class="kv-product-grid-bg-fqfzhr kv-product-grid-bd-17yl2y kv-product-grid-bd-cxmz9t kv-product-grid-bd-20shz8 kv-product-grid-bd-ycquvh kv-product-grid-box-1e75m0 kv-product-grid-fg-gtinz5 kv-product-grid-pad-583j80 kv-product-grid-pad-66mtq9" data-style-src="examples/commerce/src/components/product-grid.tsx#field"
          name="quantity"
          type="number"
          min="1"
          max={item.stock}
          value="1"
        />
        <FieldError name="quantity" class="kv-product-grid-fg-1a8f0w kv-product-grid-font-1dmql4" data-style-src="examples/commerce/src/components/product-grid.tsx#errorText" />
      </label>
      {Button.definition.render({
        children: soldOut ? 'Sold out' : 'Add to cart',
        disabled: soldOut,
        type: 'submit',
        variant: 'primary',
      })}
      <FormError
        code="OUT_OF_STOCK"
        class="kv-product-grid-fg-1a8f0w kv-product-grid-font-1dmql4" data-style-src="examples/commerce/src/components/product-grid.tsx#errorText"
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
