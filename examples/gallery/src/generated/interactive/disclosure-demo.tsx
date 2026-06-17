// @kovojs-ir - lowered from examples/gallery/src/interactive/disclosure-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime';

export const GalleryDisclosureDemo$button_aria_expanded_derive = derive(['state'], (state: any) =>
  String(state.open),
);
export const GalleryDisclosureDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDisclosureDemo$div_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDisclosureDemo$div_hidden_derive = derive(['state'], (state: any) =>
  !state.open ? '' : null,
);

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
    <section
      class={ROOT_CLASS}
      data-gallery-interactive="disclosure"
      kovo-c="gallery-disclosure-demo"
      kovo-state='{"open":false}'
    >
      <button
        aria-controls="gallery-interactive-disclosure-panel"
        class={TRIGGER_CLASS}
        on:click="/c/examples/gallery/src/generated/interactive/disclosure-demo.client.js?v=267ec72f#GalleryDisclosureDemo$button_click"
        type="button"
        aria-expanded={String(state.open)}
        data-bind:aria-expanded="/c/examples/gallery/src/generated/interactive/disclosure-demo.client.js?v=267ec72f#GalleryDisclosureDemo$button_aria_expanded_derive"
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/examples/gallery/src/generated/interactive/disclosure-demo.client.js?v=267ec72f#GalleryDisclosureDemo$button_data_state_derive"
      >
        Shipping rules
      </button>
      <div
        class={CONTENT_CLASS}
        id="gallery-interactive-disclosure-panel"
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/examples/gallery/src/generated/interactive/disclosure-demo.client.js?v=267ec72f#GalleryDisclosureDemo$div_data_state_derive"
        hidden={!state.open}
        data-bind:hidden="/c/examples/gallery/src/generated/interactive/disclosure-demo.client.js?v=267ec72f#GalleryDisclosureDemo$div_hidden_derive"
      >
        Orders over $50 ship free.
      </div>
    </section>
  ),
});
GalleryDisclosureDemo.name = 'generated/interactive/disclosure-demo/gallery-disclosure-demo';
