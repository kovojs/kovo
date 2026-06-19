import {
  createQueryStore,
  type EnhancedMutationFetch,
  installKovoLoader,
  type MorphRoot,
  type TargetCollectorRoot,
} from '@kovojs/runtime/client';
import { DomMorphRoot, keyedDomMorph } from '@kovojs/runtime/internal/morph';
import {
  type BroadcastLike,
  installMutationBroadcast,
  submitEnhancedMutation,
} from '@kovojs/runtime/internal/mutation';

declare global {
  interface Window {
    __broadcastSyncReady?: boolean;
  }
}

const store = createQueryStore();
const root = Object.assign(new DomMorphRoot(document), {
  querySelectorAll: document.querySelectorAll.bind(document),
}) as MorphRoot & TargetCollectorRoot;

installKovoLoader({
  importModule: (url) => import(/* @vite-ignore */ url),
  queryStore: store,
  root: document,
});

const broadcast = installMutationBroadcast({
  channel: new BroadcastChannel('kovo:mutation-response') as BroadcastLike,
  morph: keyedDomMorph,
  root,
  store,
});

document.getElementById('presence-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;

  void submitEnhancedMutation({
    broadcast,
    fetch: window.fetch.bind(window) as EnhancedMutationFetch,
    form,
    formData: new FormData(form),
    morph: keyedDomMorph,
    root,
    store,
  });
});

window.__broadcastSyncReady = true;
