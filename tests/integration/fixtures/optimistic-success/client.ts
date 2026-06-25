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

document.querySelector<HTMLButtonElement>('state-toggle button')?.addEventListener('click', () => {
  const host = document.querySelector<HTMLElement>('state-toggle');
  const output = document.querySelector<HTMLElement>('[data-testid="toggle-state"]');
  if (!host || !output) return;

  const current = JSON.parse(host.getAttribute('kovo-state') ?? '{"on":false}') as {
    on?: boolean;
  };
  const next = { on: !current.on };
  host.setAttribute('kovo-state', JSON.stringify(next));
  output.textContent = String(next.on);
});

window.__optimisticSuccessReady = true;
