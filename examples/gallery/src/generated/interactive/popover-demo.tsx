// @kovojs-ir - lowered from examples/gallery/src/interactive/popover-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryPopoverDemo$Popover_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryPopoverDemo$PopoverTrigger_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryPopoverDemo$PopoverContent_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryPopoverDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import { Popover, PopoverContent, PopoverTrigger } from '@kovojs/ui/popover';

export interface GalleryPopoverDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryPopoverDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryPopoverDemoState) => {
    const contentId = 'gallery-popover-content';

    return (
      <Popover
        data-gallery-interactive="popover"
        open={state.open}
        data-bind:open="/c/__v/3339a90b/examples/gallery/src/generated/interactive/popover-demo.client.js#GalleryPopoverDemo$Popover_open_derive"
        kovo-state='{"open":false}'
      >
        <PopoverTrigger
          contentId={contentId}
          open={state.open}
          data-bind:open="/c/__v/3339a90b/examples/gallery/src/generated/interactive/popover-demo.client.js#GalleryPopoverDemo$PopoverTrigger_open_derive"
        >
          Delivery window
        </PopoverTrigger>
        <PopoverContent
          contentId={contentId}
          on:beforetoggle="/c/__v/3339a90b/examples/gallery/src/generated/interactive/popover-demo.client.js#GalleryPopoverDemo$PopoverContent_beforetoggle"
          open={state.open}
          data-bind:open="/c/__v/3339a90b/examples/gallery/src/generated/interactive/popover-demo.client.js#GalleryPopoverDemo$PopoverContent_open_derive"
        >
          Weekday arrivals are available from 9 AM to 5 PM.
        </PopoverContent>
        <output
          data-demo-state="popover-open"
          data-bind="/c/__v/3339a90b/examples/gallery/src/generated/interactive/popover-demo.client.js#GalleryPopoverDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </Popover>
    );
  },
});
GalleryPopoverDemo.name = 'generated/interactive/popover-demo/gallery-popover-demo';
