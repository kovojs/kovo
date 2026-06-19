// @kovojs-ir - lowered from examples/gallery/src/interactive/collapsible-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryCollapsibleDemo$Collapsible_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryCollapsibleDemo$CollapsibleTrigger_open_derive = derive(
  ['state'],
  (state: any) => (state.open ? '' : null),
);
export const GalleryCollapsibleDemo$CollapsibleContent_open_derive = derive(
  ['state'],
  (state: any) => (state.open ? '' : null),
);

import { component } from '@kovojs/core';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@kovojs/ui/collapsible';

export interface GalleryCollapsibleDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryCollapsibleDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryCollapsibleDemoState) => {
    const contentId = 'gallery-collapsible-content';

    return (
      <Collapsible
        data-gallery-interactive="collapsible"
        open={state.open}
        data-bind:open="/c/__v/c97b05d2/examples/gallery/src/generated/interactive/collapsible-demo.client.js#GalleryCollapsibleDemo$Collapsible_open_derive"
        kovo-state='{"open":false}'
      >
        <CollapsibleTrigger
          contentId={contentId}
          on:click="/c/__v/c97b05d2/examples/gallery/src/generated/interactive/collapsible-demo.client.js#GalleryCollapsibleDemo$CollapsibleTrigger_click"
          open={state.open}
          data-bind:open="/c/__v/c97b05d2/examples/gallery/src/generated/interactive/collapsible-demo.client.js#GalleryCollapsibleDemo$CollapsibleTrigger_open_derive"
        >
          Release notes
        </CollapsibleTrigger>
        <CollapsibleContent
          contentId={contentId}
          open={state.open}
          data-bind:open="/c/__v/c97b05d2/examples/gallery/src/generated/interactive/collapsible-demo.client.js#GalleryCollapsibleDemo$CollapsibleContent_open_derive"
        >
          Added browser-backed compiled coverage.
        </CollapsibleContent>
      </Collapsible>
    );
  },
});
GalleryCollapsibleDemo.name = 'generated/interactive/collapsible-demo/gallery-collapsible-demo';
