// @jiso-ir - lowered from examples/gallery/src/interactive/disclosure-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { derive } from '@jiso/runtime';

export const GalleryDisclosureDemo$button_aria_expanded_derive = derive(['state'], (state) =>
  String(state.open),
);
export const GalleryDisclosureDemo$button_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDisclosureDemo$div_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDisclosureDemo$div_hidden_derive = derive(['state'], (state) =>
  !state.open ? '' : null,
);

import { component } from '@jiso/core';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/disclosure.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS = 'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50';
const TRIGGER_CLASS =
  'inline-flex h-9 w-fit items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-neutral-100';
const CONTENT_CLASS =
  'rounded-md border border-neutral-200 bg-white p-3 text-sm text-neutral-700 data-[state=closed]:hidden';

export interface GalleryDisclosureDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryDisclosureDemo = component('gallery-disclosure-demo', {
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryDisclosureDemoState) => (
    <section
      class={ROOT_CLASS}
      data-gallery-interactive="disclosure"
      fw-c="gallery-disclosure-demo"
      fw-state='{"open":false}'
    >
      <button
        aria-controls="gallery-interactive-disclosure-panel"
        data-bind:aria-expanded="/c/examples/gallery/src/generated/interactive/disclosure-demo.client.js?v=ba041580#GalleryDisclosureDemo$button_aria_expanded_derive"
        class={TRIGGER_CLASS}
        data-bind:data-state="/c/examples/gallery/src/generated/interactive/disclosure-demo.client.js?v=ba041580#GalleryDisclosureDemo$button_data_state_derive"
        on:click="/c/examples/gallery/src/generated/interactive/disclosure-demo.client.js?v=ba041580#GalleryDisclosureDemo$button_click"
        type="button"
      >
        Shipping rules
      </button>
      <div
        class={CONTENT_CLASS}
        data-bind:data-state="/c/examples/gallery/src/generated/interactive/disclosure-demo.client.js?v=ba041580#GalleryDisclosureDemo$div_data_state_derive"
        data-bind:hidden="/c/examples/gallery/src/generated/interactive/disclosure-demo.client.js?v=ba041580#GalleryDisclosureDemo$div_hidden_derive"
        id="gallery-interactive-disclosure-panel"
      >
        Orders over $50 ship free.
      </div>
    </section>
  ),
});
