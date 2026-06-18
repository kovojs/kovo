// @kovojs-ir - lowered from examples/gallery/src/interactive/disclosure-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

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
import {
  disclosureClasses,
  disclosureTriggerClasses,
  disclosureContentClasses,
} from '@kovojs/ui/disclosure';

const ROOT_CLASS = disclosureClasses.join(' ');
const TRIGGER_CLASS = disclosureTriggerClasses.join(' ');
const CONTENT_CLASS = disclosureContentClasses.join(' ');

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
        on:click="/c/__v/c6b93550/examples/gallery/src/generated/interactive/disclosure-demo.client.js#GalleryDisclosureDemo$button_click"
        type="button"
        aria-expanded={String(state.open)}
        data-bind:aria-expanded="/c/__v/c6b93550/examples/gallery/src/generated/interactive/disclosure-demo.client.js#GalleryDisclosureDemo$button_aria_expanded_derive"
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/c6b93550/examples/gallery/src/generated/interactive/disclosure-demo.client.js#GalleryDisclosureDemo$button_data_state_derive"
      >
        Shipping rules
      </button>
      <div
        class={CONTENT_CLASS}
        id="gallery-interactive-disclosure-panel"
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/c6b93550/examples/gallery/src/generated/interactive/disclosure-demo.client.js#GalleryDisclosureDemo$div_data_state_derive"
        hidden={!state.open}
        data-bind:hidden="/c/__v/c6b93550/examples/gallery/src/generated/interactive/disclosure-demo.client.js#GalleryDisclosureDemo$div_hidden_derive"
      >
        Orders over $50 ship free.
      </div>
    </section>
  ),
});
GalleryDisclosureDemo.name = 'generated/interactive/disclosure-demo/gallery-disclosure-demo';
