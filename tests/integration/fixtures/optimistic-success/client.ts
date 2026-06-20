import {
  createQueryStore,
  type EnhancedMutationFetch,
  type MorphRoot,
  type TargetCollectorRoot,
  installKovoLoader,
} from '@kovojs/browser/client';
import { DomMorphRoot, keyedDomMorph } from '@kovojs/browser/internal/morph';
import {
  applyCompiledQueryUpdatePlan,
  OptimisticRebaser,
  submitOptimisticEnhancedMutation,
} from '@kovojs/browser/internal/mutation';

import { applyCartDerives } from './cart-derive';

type CartSummary = Record<string, unknown> & {
  count: number;
};

declare global {
  interface Window {
    __optimisticSuccessReady?: boolean;
  }
}

const store = createQueryStore();
const rebaser = new OptimisticRebaser(store);
const root = Object.assign(new DomMorphRoot(document), {
  querySelectorAll: document.querySelectorAll.bind(document),
}) as MorphRoot & TargetCollectorRoot;

installKovoLoader({
  importModule: (url) => import(/* @vite-ignore */ url),
  queryStore: store,
  root: document,
});

store.subscribe<CartSummary>('cart', (cart) => {
  applyCompiledQueryUpdatePlan(document, 'cart', cart);
  // Derived-optimism (C6): the same store update that drives the optimistic prediction
  // also recomputes the cart-derived binding, so it predicts + reconciles in lockstep.
  applyCartDerives(cart, document);
});

document.getElementById('optimistic-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const formData = new FormData(form);
  const quantity = Number(formData.get('quantity') ?? 0);

  void submitOptimisticEnhancedMutation({
    fetch: window.fetch.bind(window) as EnhancedMutationFetch,
    form,
    formData,
    input: { quantity },
    morph: keyedDomMorph,
    optimistic: {
      transforms: {
        cart(current: unknown, input: { quantity: number }) {
          const cart = current as CartSummary;
          return { count: cart.count + input.quantity };
        },
      },
    },
    pendingRoot: document,
    rebaser,
    root,
    store,
  });
});

window.__optimisticSuccessReady = true;
