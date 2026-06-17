/** @jsxImportSource @kovojs/server */
import { component, form } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import {
  componentMutationFailureSlots,
  renderComponent,
  renderComponentMutationFailure,
} from './component-render.js';
import type { MutationFail } from './mutation.js';

describe('renderComponent', () => {
  it('passes SPEC §4.5 render-time children and named slots to component render', () => {
    const Card = component({
      render: (
        { title }: { title: string },
        _state,
        { children, footer }: { children?: unknown; footer?: unknown },
      ) => (
        <section>
          <h2>{title}</h2>
          <div data-slot="body">{children}</div>
          <footer>{footer}</footer>
        </section>
      ),
    });

    expect(
      renderComponent(
        Card,
        { title: 'Cart' },
        { slots: { children: <p>Ready</p>, footer: 'Done' } },
      ),
    ).toBe(
      '<section><h2>Cart</h2><div data-slot="body"><p>Ready</p></div><footer>Done</footer></section>',
    );
  });

  it('injects SPEC §6.3 typed mutation failure state into component render slots', () => {
    const addToCart = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK'; payload: { availableQuantity: number } }
    >('cart/add');
    const AddToCartForm = component({
      mutations: { addToCart },
      render: (_queries, _state, { forms }) => (
        <form aria-invalid={forms.addToCart.failure ? 'true' : undefined}>
          {forms.addToCart.failure?.code === 'OUT_OF_STOCK' ? (
            <output role="alert">
              Only {forms.addToCart.failure.payload.availableQuantity} left.
            </output>
          ) : null}
        </form>
      ),
    });
    const failure: MutationFail<'OUT_OF_STOCK', { availableQuantity: number }> = {
      error: { code: 'OUT_OF_STOCK', payload: { availableQuantity: 2 } },
      ok: false,
      status: 422,
    };

    expect(
      renderComponentMutationFailure(AddToCartForm, {}, failure, { formName: 'addToCart' }),
    ).toBe('<form aria-invalid="true"><output role="alert">Only 2 left.</output></form>');
  });

  it('normalizes schema validation failures into field-scoped component form state', () => {
    const slots = componentMutationFailureSlots('addToCart', {
      error: {
        code: 'VALIDATION',
        payload: {
          issues: [{ message: 'Expected number >= 1', path: ['quantity'] }],
        },
      },
      ok: false,
      status: 422,
    });

    expect(slots.forms).toEqual({
      addToCart: {
        failure: {
          code: 'VALIDATION',
          fieldErrors: { quantity: 'Expected number >= 1' },
        },
      },
    });
  });
});
