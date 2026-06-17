import {
  createQueryStore,
  DomMorphRoot,
  type EnhancedMutationFetch,
  keyedDomMorph,
  type MorphRoot,
  submitEnhancedMutation,
  type TargetCollectorRoot,
} from '@kovojs/runtime';

declare global {
  interface Window {
    __morphNestedIslandReady?: boolean;
  }
}

const store = createQueryStore();
const root = Object.assign(new DomMorphRoot(document), {
  querySelectorAll: document.querySelectorAll.bind(document),
}) as MorphRoot & TargetCollectorRoot;

document.getElementById('refresh-parent')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;

  void submitEnhancedMutation({
    fetch: window.fetch.bind(window) as EnhancedMutationFetch,
    form,
    formData: new FormData(form),
    morph: keyedDomMorph,
    root,
    store,
  });
});

export function incrementNested(_event: Event, context: { state: { count?: number } }): void {
  context.state.count = (context.state.count ?? 0) + 1;
}

window.__morphNestedIslandReady = true;
