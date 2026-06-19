import { createQueryStore, type InlineQueryEvent } from '@kovojs/runtime/client';
import { applyInlineQueryEventToRuntime } from '@kovojs/runtime/internal/inline-loader';

declare global {
  interface Window {
    __deriveBindingImports?: number;
  }
}

const store = createQueryStore();
window.__deriveBindingImports = 0;

window.addEventListener('kovo:query', (event) => {
  void applyInventoryQuery(event as InlineQueryEvent);
});

async function applyInventoryQuery(event: InlineQueryEvent): Promise<void> {
  const applied = applyInlineQueryEventToRuntime(event, { root: document, store });
  if (!applied.includes('inventory')) return;

  window.__deriveBindingImports = (window.__deriveBindingImports ?? 0) + 1;
  const modulePath = '/derive.ts';
  const module = (await import(/* @vite-ignore */ modulePath)) as typeof import('./derive');
  module.applyInventoryDerives(store.get('inventory'), document);
}
