import { installKovoLoader } from '@kovojs/browser/client';
import { installOptimisticFixtureClient } from '@kovojs/test/internal/integration/optimistic-client';

import { applyCartDerives } from './cart-derive';

type CartSummary = Record<string, unknown> & {
  count: number;
};

declare global {
  interface Window {
    __optimisticSuccessReady?: boolean;
  }
}

const optimisticClient = installOptimisticFixtureClient({
  installLoader: false,
  importModule: (url) => import(/* @vite-ignore */ url),
  queries: {
    cart(cart) {
      // Derived-optimism (C6): the same store update that drives the optimistic prediction
      // also recomputes the cart-derived binding, so it predicts + reconciles in lockstep.
      applyCartDerives(cart, document);
    },
  },
});

installKovoLoader({
  // The document's inline loader owns delegated events. This fixture-only instance injects the
  // optimistic query store without registering a second copy of each authored handler.
  events: [],
  importModule: (url) => import(/* @vite-ignore */ url),
  queryStore: optimisticClient.store,
  root: document,
});

document.getElementById('optimistic-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const formData = new FormData(form);
  const quantity = Number(formData.get('quantity') ?? 0);

  void optimisticClient.submitForm(form, {
    formData,
    input: { quantity },
    optimistic: {
      transforms: {
        cart(current: unknown, input: { quantity: number }) {
          const cart = current as CartSummary;
          return { count: cart.count + input.quantity };
        },
      },
    },
  });
});

window.__optimisticSuccessReady = true;
