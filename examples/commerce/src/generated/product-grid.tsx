// @kovojs-ir — lowered from examples/commerce/src/components/product-grid.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
import { component, form, type ComponentRenderSlots, type FormFailure } from '@kovojs/core';
import { componentMutationFailureSlots, csrfField, type MutationFail } from '@kovojs/server';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';

import { commerceCsrf, type CommerceRequest, type ProductGridResult } from '../app.js';
import { productGridQuery } from '../queries.js';
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer, type LiveTargetRenderContext, type LiveTargetRenderer } from '@kovojs/server/internal/wire';


// SPEC.md section 4.1/4.2: authored sugar carries no stamps. The native
// <section> host gets its product-grid kovo-c identity stamp and the
// kovo-deps stamp (from the queries declaration) from the compiler (section
// 4.8); grid updates flow as server fragments (the section 4.8 ceiling:
// keyed per-item markup with request-scoped forms is beyond paths, derives,
// and keyed lists), declared await-fragment in addToCartOptimistic.
//
// Render slots carry request-only CSRF data and SPEC.md §6.3 mutation form
// state. The lowered IR is committed at src/generated/product-grid.tsx and is
// what the app imports at runtime.

const addToCartForm = form<
  'cart/add',
  { productId: string; quantity: number },
  { code: 'OUT_OF_STOCK'; payload: { availableQuantity: number } }
>('cart/add');

export type AddToCartFailure = FormFailure<typeof addToCartForm>;

type ProductGridMutationSlots = ComponentRenderSlots<{ addToCart: typeof addToCartForm }>;

export type ProductGridRenderSlots = ProductGridMutationSlots & {
  productId?: string | undefined;
  readOnly?: boolean | undefined;
  request?: CommerceRequest | undefined;
};

const defaultProductGridRenderSlots: ProductGridRenderSlots = {
  forms: { addToCart: { failure: null } },
};

export const ProductGrid = component({
  mutations: { addToCart: addToCartForm },
  queries: { productGrid: productGridQuery },
  render: (
    { productGrid }: { productGrid: ProductGridResult },
    _state,
    slots: ProductGridRenderSlots = defaultProductGridRenderSlots,
  ) => {
    const { nextCursor } = productGrid;
    return (
      <section data-page-cursor={nextCursor ?? ''} kovo-c="product-grid" kovo-deps="productGrid" kovo-fragment-target="product-grid" kovo-live-component="components/product-grid/product-grid">
        {renderProductGridItems(
          productGrid,
          slots.productId,
          slots.forms.addToCart.failure,
          slots.request,
          {
            readOnly: slots.readOnly,
          },
        )}
      </section>
    );
  },
});
ProductGrid.name = "components/product-grid/product-grid";

// Card list without the component host, shared by the grid render and the
// mode="append" pagination fragment (which morphs into the existing host).
export function renderProductGridItems(
  result: ProductGridResult,
  failureProductId?: string,
  failure?: AddToCartFailure | null,
  request?: CommerceRequest,
  options: { readOnly?: boolean | undefined } = {},
): string {
  const cards = result.items.map((item) =>
    renderProductCard(item, failureProductId === item.id ? failure : null, request, options),
  );
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

// The product catalog row the grid renders (the productGrid query select shape).
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

function renderProductCard(
  item: ProductItem,
  failure?: AddToCartFailure | null,
  request?: CommerceRequest,
  options: { readOnly?: boolean | undefined } = {},
): string {
  const body = (
    <div class="grid gap-4">
      <div class="flex items-center gap-4">
        <span class="grid h-12 w-12 place-items-center rounded-md bg-slate-50 text-2xl">
          {escapeText(item.emoji)}
        </span>
        <div class="grid gap-1">
          <h2 class="font-semibold tracking-tight">{escapeText(item.name)}</h2>
          {Badge.definition.render({ variant: 'neutral', children: item.category })}
        </div>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-lg font-semibold tabular-nums">{priceLabel(item.unitPrice)}</span>
        {stockBadge(item.stock)}
      </div>
      {options.readOnly ? '' : renderAddToCartForm(item, failure, request)}
    </div>
  );
  // `kovo-key` stays on the keyed child of the grid fragment host (§9.1 morph);
  // the @kovojs/ui Card provides the surface inside it.
  return <article kovo-key={item.id}>{Card.definition.render({ children: body })}</article>;
}

// SPEC.md section 6.3: the no-JS add-to-cart form posts to the mutation
// endpoint; `enhance` upgrades it to the section 9.1 fragment wire. Rendered
// standalone as the failure-rerender fragment (kovo-fragment-target).
export function renderAddToCartForm(
  item: { id: string; stock: number },
  failure?: AddToCartFailure | null,
  request?: CommerceRequest,
): string {
  const soldOut = item.stock === 0;
  return (
    <form enhance method="post" action="/_m/cart/add" data-mutation="cart/add" kovo-fragment-target={`add-to-cart:${item.id}`} kovo-key={item.id} class="flex flex-wrap items-end gap-2">
      {request?.session?.id ? csrfField(request, commerceCsrf) : ''}
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
      </label>
      {Button.definition.render({
        children: soldOut ? 'Sold out' : 'Add to cart',
        disabled: soldOut,
        type: 'submit',
        variant: 'primary',
      })}
      {failure ? renderAddToCartError(failure) : ''}
    </form>
  );
}

export function renderAddToCartMutationFailureForm(
  item: { id: string; stock: number },
  failure: MutationFail,
  request?: CommerceRequest,
): string {
  return renderAddToCartForm(item, addToCartFailureFromMutation(failure), request);
}

export function renderAddToCartMutationFailureError(failure: MutationFail): string {
  return renderAddToCartError(addToCartFailureFromMutation(failure));
}

export function renderAddToCartError(failure: AddToCartFailure): string {
  if (failure.code === 'OUT_OF_STOCK') {
    return (
      <output role="alert" data-error-code="OUT_OF_STOCK" class="basis-full text-sm text-red-700">
        Only {escapeText(failure.payload.availableQuantity)} available.
      </output>
    );
  }

  if (failure.code === 'VALIDATION') {
    return (
      <output role="alert" data-error-code="VALIDATION" class="basis-full text-sm text-red-700">
        Unable to add this item.
      </output>
    );
  }

  return '';
}

function addToCartFailureFromMutation(failure: MutationFail): AddToCartFailure {
  const slots = componentMutationFailureSlots(
    'addToCart',
    failure,
    defaultProductGridRenderSlots,
  ) as unknown as ProductGridRenderSlots;
  const formFailure = slots.forms.addToCart.failure;
  if (!formFailure) {
    throw new Error('Expected add-to-cart mutation failure slot');
  }

  return formFailure;
}

export const ProductGrid$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: ProductGrid,
  componentId: "components/product-grid/product-grid",
  queries: [
    {
      name: "productGrid",
      query: productGridQuery,
    },
  ],
}));

const ProductGrid$commerceLiveTargetRenderer: LiveTargetRenderer<CommerceRequest> = {
  ...ProductGrid$liveTargetRenderer,
  errorBoundary: {
    render(error: unknown) {
      return `<section role="alert" class="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">Product grid failed: ${escapeText((error as Error).message)}</section>`;
    },
  },
  render(context: LiveTargetRenderContext<CommerceRequest>) {
    const productGridError = context.request.renderFaults?.productGrid?.();
    if (productGridError) throw productGridError;
    return ProductGrid$liveTargetRenderer.render(context);
  },
};

registerGeneratedLiveTargetRenderer(ProductGrid$commerceLiveTargetRenderer);
