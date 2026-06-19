import {
  createQueryStore,
  type EnhancedMutationFetch,
  type MorphRoot,
  type TargetCollectorRoot,
  installKovoLoader,
} from '@kovojs/runtime/client';
import { DomMorphRoot, keyedDomMorph } from '@kovojs/runtime/internal/morph';
import {
  applyCompiledQueryUpdatePlan,
  OptimisticRebaser,
  submitOptimisticEnhancedMutation,
} from '@kovojs/runtime/internal/mutation';

type CartSummary = Record<string, unknown> & {
  count: number;
};

declare global {
  interface Window {
    __optimisticRebasePendingCount?: () => number;
    __optimisticRebaseReady?: boolean;
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
});

function installOptimisticSubmit(form: HTMLFormElement): void {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const quantity = Number(formData.get('quantity') ?? 0);
    const delay = Number(formData.get('delay') ?? 0);

    void submitOptimisticEnhancedMutation({
      fetch: window.fetch.bind(window) as EnhancedMutationFetch,
      form,
      formData,
      input: { delay, quantity },
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
}

for (const form of document.querySelectorAll<HTMLFormElement>('#first-form, #second-form')) {
  installOptimisticSubmit(form);
}

window.__optimisticRebaseReady = true;
window.__optimisticRebasePendingCount = () => rebaser.pendingCount('cart');
