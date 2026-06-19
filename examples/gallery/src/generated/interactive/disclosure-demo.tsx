// @kovojs-ir - lowered from examples/gallery/src/interactive/disclosure-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryDisclosureDemo$Disclosure_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryDisclosureDemo$DisclosureTrigger_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryDisclosureDemo$DisclosureContent_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryDisclosureDemo$Disclosure_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDisclosureDemo$DisclosureTrigger_aria_expanded_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'true' : 'false'),
);
export const GalleryDisclosureDemo$DisclosureTrigger_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryDisclosureDemo$DisclosureContent_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryDisclosureDemo$DisclosureContent_hidden_derive = derive(
  ['state'],
  (state: any) => (state.open ? null : ''),
);

import { component } from '@kovojs/core';
import { Disclosure, DisclosureContent, DisclosureTrigger } from '@kovojs/ui/disclosure';

export interface GalleryDisclosureDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryDisclosureDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryDisclosureDemoState) => (
    <Disclosure
      data-gallery-interactive="disclosure"
      open={state.open}
      data-bind:open="/c/__v/f68e6d34/examples/gallery/src/generated/interactive/disclosure-demo.client.js#GalleryDisclosureDemo$Disclosure_open_derive"
      data-bind:data-state="/c/__v/f68e6d34/examples/gallery/src/generated/interactive/disclosure-demo.client.js#GalleryDisclosureDemo$Disclosure_data_state_derive"
      kovo-state='{"open":false}'
    >
      <DisclosureTrigger
        contentId="gallery-interactive-disclosure-panel"
        on:click="/c/__v/f68e6d34/examples/gallery/src/generated/interactive/disclosure-demo.client.js#GalleryDisclosureDemo$DisclosureTrigger_click"
        open={state.open}
        data-bind:open="/c/__v/f68e6d34/examples/gallery/src/generated/interactive/disclosure-demo.client.js#GalleryDisclosureDemo$DisclosureTrigger_open_derive"
        data-bind:aria-expanded="/c/__v/f68e6d34/examples/gallery/src/generated/interactive/disclosure-demo.client.js#GalleryDisclosureDemo$DisclosureTrigger_aria_expanded_derive"
        data-bind:data-state="/c/__v/f68e6d34/examples/gallery/src/generated/interactive/disclosure-demo.client.js#GalleryDisclosureDemo$DisclosureTrigger_data_state_derive"
      >
        Shipping rules
      </DisclosureTrigger>
      <DisclosureContent
        contentId="gallery-interactive-disclosure-panel"
        open={state.open}
        data-bind:open="/c/__v/f68e6d34/examples/gallery/src/generated/interactive/disclosure-demo.client.js#GalleryDisclosureDemo$DisclosureContent_open_derive"
        data-bind:data-state="/c/__v/f68e6d34/examples/gallery/src/generated/interactive/disclosure-demo.client.js#GalleryDisclosureDemo$DisclosureContent_data_state_derive"
        data-bind:hidden="/c/__v/f68e6d34/examples/gallery/src/generated/interactive/disclosure-demo.client.js#GalleryDisclosureDemo$DisclosureContent_hidden_derive"
      >
        Orders over $50 ship free.
      </DisclosureContent>
    </Disclosure>
  ),
});
GalleryDisclosureDemo.name = 'generated/interactive/disclosure-demo/gallery-disclosure-demo';
