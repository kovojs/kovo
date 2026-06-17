/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { disclosureTriggerClick as _disclosureTriggerClick } from '@kovojs/headless-ui/primitives';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/disclosure.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const ROOT_CLASS = 'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50';
const TRIGGER_CLASS =
  'inline-flex h-9 w-fit items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-neutral-100';
const CONTENT_CLASS =
  'rounded-md border border-neutral-200 bg-white p-3 text-sm text-neutral-700 data-[state=closed]:hidden';

export interface GalleryDisclosureDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryDisclosureDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryDisclosureDemoState) => (
    <section class={ROOT_CLASS} data-gallery-interactive="disclosure">
      <button
        aria-controls="gallery-interactive-disclosure-panel"
        aria-expanded={String(state.open)}
        class={TRIGGER_CLASS}
        data-state={state.open ? 'open' : 'closed'}
        onClick={() => {
          const result = _disclosureTriggerClick(Object(event), { open: state.open });
          if (!result) return;
          state.open = result.open;
        }}
        type="button"
      >
        Shipping rules
      </button>
      <div
        class={CONTENT_CLASS}
        data-state={state.open ? 'open' : 'closed'}
        hidden={!state.open}
        id="gallery-interactive-disclosure-panel"
      >
        Orders over $50 ship free.
      </div>
    </section>
  ),
});
