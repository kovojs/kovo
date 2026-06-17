/** @jsxImportSource @kovojs/server */
import { component, form, type FormFailure } from '@kovojs/core';
import { componentMutationFailureSlots, csrfField, type MutationFail } from '@kovojs/server';

import {
  addToCart,
  commerceCsrf,
  type CommerceRequest,
  type ProductGridResult,
} from '../app.js';
import { productGridQuery } from '../queries.js';

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

export interface ProductGridRenderSlots {
  forms: {
    addToCart: {
      failure: AddToCartFailure | null;
    };
  };
  productId?: string | undefined;
  readOnly?: boolean | undefined;
  request?: CommerceRequest | undefined;
}

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
      <section data-page-cursor={nextCursor ?? ''}>
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
    renderProductCard(
      item,
      failureProductId === item.id ? failure : null,
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
  failure?: AddToCartFailure | null,
  request?: CommerceRequest,
  options: { readOnly?: boolean | undefined } = {},
): string {
  return (
    <article kovo-key={item.id} class="rounded border border-slate-200 bg-white p-4">
      <h2 class="font-semibold">{item.id}</h2>
      <p>{item.stock} in stock</p>
      {options.readOnly ? '' : renderAddToCartForm(item, failure, request)}
    </article>
  );
}

// SPEC.md section 6.3: the no-JS add-to-cart form posts to the mutation
// endpoint; `enhance` upgrades it to the section 9.1 fragment wire. Rendered
// standalone as the failure-rerender fragment (kovo-fragment-target).
export function renderAddToCartForm(
  item: { id: string; stock: number },
  failure?: AddToCartFailure | null,
  request?: CommerceRequest,
): string {
  return (
    <form
      enhance
      mutation={addToCart}
      key={item.id}
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
        Only {failure.payload.availableQuantity} available.
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

  return (
    <output
      role="alert"
      data-error-code={failure.code}
      class="basis-full text-sm text-red-700"
    >
      Unable to add this item.
    </output>
  );
}

function addToCartFailureFromMutation(failure: MutationFail): AddToCartFailure {
  const slots = componentMutationFailureSlots(
    'addToCart',
    failure,
    defaultProductGridRenderSlots,
  ) as ProductGridRenderSlots;
  const formFailure = slots.forms.addToCart.failure;
  if (!formFailure) {
    throw new Error('Expected add-to-cart mutation failure slot');
  }

  return formFailure;
}
