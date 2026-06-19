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
  stampPendingQueries,
  submitOptimisticEnhancedMutation,
} from '@kovojs/runtime/internal/mutation';

type NavCounter = Record<string, unknown> & {
  value: number;
};

declare global {
  interface Window {
    __bfcacheLifecycleReady?: boolean;
    __bfcachePendingCount?: () => number;
  }
}

const store = createQueryStore();
const rebaser = new OptimisticRebaser(store);
const root = Object.assign(new DomMorphRoot(document), {
  querySelectorAll: document.querySelectorAll.bind(document),
}) as MorphRoot & TargetCollectorRoot;

installKovoLoader({
  discardPendingOptimism() {
    const discarded = rebaser.discardPendingOptimism();
    stampPendingQueries(document, discarded, false);
    return discarded;
  },
  importModule: (url) => import(/* @vite-ignore */ url),
  queryRefetch: { fetch: window.fetch.bind(window) },
  queryStore: store,
  root: document,
});

store.subscribe<NavCounter>('navCounter', (counter) => {
  applyCompiledQueryUpdatePlan(document, 'navCounter', counter);
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
        navCounter(current: unknown, input: { quantity: number }) {
          const counter = current as NavCounter;
          return { value: counter.value + input.quantity };
        },
      },
    },
    pendingRoot: document,
    rebaser,
    root,
    store,
  });
});

window.__bfcachePendingCount = () => rebaser.pendingCount('navCounter');
window.__bfcacheLifecycleReady = true;
