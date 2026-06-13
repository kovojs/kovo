// @jiso-ir — lowered from examples/commerce/src/components/product-grid.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import { csrfField } from '@jiso/server';

import {
  commerceCsrf,
  type AddToCartFailure,
  type AddToCartFailureState,
  type CommerceRequest,
  type ProductGridResult,
} from '../app.js';
import { productGridQuery } from '../queries.js';

// SPEC.md section 4.1/4.2: authored sugar carries no stamps. The native
// <section> host gets its product-grid fw-c identity stamp and the
// fw-deps stamp (from the queries declaration) from the compiler (section
// 4.8); grid updates flow as server fragments (the section 4.8 ceiling:
// keyed per-item markup with request-scoped forms is beyond paths, derives,
// and keyed lists), declared await-fragment in addToCartOptimistic.
//
// The render context (per-request CSRF fields and the no-JS add-to-cart
// failure state) is mutation-form infrastructure, not query data; SPEC.md
// Appendix A assigns form rendering to <f.Form>, which @jiso/server does not
// provide yet, so app.ts passes the context as an explicit second render
// argument alongside the declared queries (recorded in IMPLEMENT_v1.md).
// The lowered IR is committed at src/generated/product-grid.tsx and is what
// the app imports at runtime.

export interface ProductGridRenderContext {
  failure?: AddToCartFailureState | undefined;
  readOnly?: boolean | undefined;
  request?: CommerceRequest | undefined;
}

export const ProductGrid = component('product-grid', {
  fragmentTarget: true,
  queries: { productGrid: productGridQuery },
  render: (
    { productGrid }: { productGrid: ProductGridResult },
    context: ProductGridRenderContext = {},
  ) => {
    const { nextCursor } = productGrid;
    return (
      <section data-page-cursor={nextCursor ?? ''} fw-c="product-grid" fw-deps="productGrid">
        {renderProductGridItems(productGrid, context.failure, context.request, {
          readOnly: context.readOnly,
        })}
      </section>
    );
  },
});

// Card list without the component host, shared by the grid render and the
// mode="append" pagination fragment (which morphs into the existing host).
export function renderProductGridItems(
  result: ProductGridResult,
  failure?: AddToCartFailureState,
  request?: CommerceRequest,
  options: { readOnly?: boolean | undefined } = {},
): string {
  const cards = result.items.map((item) =>
    renderProductCard(
      item,
      failure?.productId === item.id ? failure.failure : undefined,
      request,
      options,
    ),
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

function renderProductCard(
  item: { id: string; stock: number },
  failure?: AddToCartFailure,
  request?: CommerceRequest,
  options: { readOnly?: boolean | undefined } = {},
): string {
  return (
    <article fw-key={item.id} class="rounded border border-slate-200 bg-white p-4">
      <h2 class="font-semibold">{item.id}</h2>
      <p>{item.stock} in stock</p>
      {options.readOnly ? '' : renderAddToCartForm(item, failure, request)}
    </article>
  );
}

// SPEC.md section 6.3: the no-JS add-to-cart form posts to the mutation
// endpoint; `enhance` upgrades it to the section 9.1 fragment wire. Rendered
// standalone as the failure-rerender fragment (fw-fragment-target).
export function renderAddToCartForm(
  item: { id: string; stock: number },
  failure?: AddToCartFailure,
  request?: CommerceRequest,
): string {
  return (
    <form
      method="post"
      action="/_m/cart/add"
      enhance
      data-mutation="cart/add"
      fw-fragment-target={productFormTarget(item.id)}
      class="mt-3 flex flex-wrap items-end gap-2"
    >
      {request?.session?.id ? csrfField(request, commerceCsrf) : ''}
      <input type="hidden" name="productId" value={item.id} />
      <label class="grid gap-1 text-xs font-medium text-slate-700">
        <span>Qty</span>
        <input
          class="w-16 rounded border border-slate-300 px-2 py-1"
          name="quantity"
          type="number"
          min="1"
          max={item.stock}
          value="1"
        />
      </label>
      <button class="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white" type="submit">
        Add
      </button>
      {failure ? renderAddToCartError(failure) : ''}
    </form>
  );
}

export function renderAddToCartError(failure: AddToCartFailure): string {
  if (failure.error.code === 'OUT_OF_STOCK') {
    const payload = failure.error.payload as { availableQuantity?: number };
    return (
      <output role="alert" data-error-code="OUT_OF_STOCK" class="basis-full text-sm text-red-700">
        Only {payload.availableQuantity ?? 0} available.
      </output>
    );
  }

  return (
    <output
      role="alert"
      data-error-code={failure.error.code}
      class="basis-full text-sm text-red-700"
    >
      Unable to add this item.
    </output>
  );
}

export function productFormTarget(productId: string): string {
  return `product-form:${productId}`;
}
