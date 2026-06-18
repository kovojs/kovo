import {
  createQueryStore,
  DomMorphRoot,
  type BroadcastLike,
  type EnhancedMutationFetch,
  installKovoLoader,
  installMutationBroadcast,
  keyedDomMorph,
  type MorphRoot,
  submitEnhancedMutation,
  type TargetCollectorRoot,
} from '@kovojs/runtime/client';

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
