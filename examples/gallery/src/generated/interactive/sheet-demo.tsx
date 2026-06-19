// @kovojs-ir - lowered from examples/gallery/src/interactive/sheet-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GallerySheetDemo$SheetRoot_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GallerySheetDemo$SheetRoot_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GallerySheetDemo$SheetTrigger_aria_expanded_derive = derive(['state'], (state: any) =>
  state.open ? 'true' : 'false',
);
export const GallerySheetDemo$SheetTrigger_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GallerySheetDemo$SheetTrigger_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GallerySheetDemo$SheetContent_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GallerySheetDemo$SheetContent_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GallerySheetDemo$SheetClose_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GallerySheetDemo$SheetClose_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GallerySheetDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import {
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetRoot,
  SheetTitle,
  SheetTrigger,
} from '@kovojs/ui/sheet';

export interface GallerySheetDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GallerySheetDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GallerySheetDemoState) => {
    const contentId = 'gallery-interactive-sheet-content';
    const titleId = 'gallery-interactive-sheet-title';
    const descriptionId = 'gallery-interactive-sheet-description';

    return (
      <SheetRoot
        data-gallery-interactive="sheet"
        data-side="right"
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/89f46c82/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$SheetRoot_data_state_derive"
        open={state.open}
        data-bind:open="/c/__v/89f46c82/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$SheetRoot_open_derive"
        kovo-state='{"open":false}'
      >
        <SheetTrigger
          contentId={contentId}
          on:click="/c/__v/89f46c82/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$SheetTrigger_click"
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/__v/89f46c82/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$SheetTrigger_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/89f46c82/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$SheetTrigger_data_state_derive"
          open={state.open}
          data-bind:open="/c/__v/89f46c82/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$SheetTrigger_open_derive"
        >
          Open sheet
        </SheetTrigger>
        <SheetContent
          contentId={contentId}
          data-side="right"
          descriptionId={descriptionId}
          on:cancel="/c/__v/89f46c82/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$SheetContent_cancel"
          side="right"
          titleId={titleId}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/89f46c82/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$SheetContent_data_state_derive"
          open={state.open}
          data-bind:open="/c/__v/89f46c82/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$SheetContent_open_derive"
        >
          <SheetHeader>
            <SheetTitle id={titleId}>Account settings</SheetTitle>
            <SheetDescription id={descriptionId}>
              Review the account panel side sheet.
            </SheetDescription>
          </SheetHeader>
          <SheetClose
            contentId={contentId}
            on:click="/c/__v/89f46c82/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$SheetClose_click"
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/__v/89f46c82/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$SheetClose_data_state_derive"
            open={state.open}
            data-bind:open="/c/__v/89f46c82/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$SheetClose_open_derive"
          >
            Close sheet
          </SheetClose>
        </SheetContent>
        <output
          data-demo-state="sheet-open"
          data-bind="/c/__v/89f46c82/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </SheetRoot>
    );
  },
});
GallerySheetDemo.name = 'generated/interactive/sheet-demo/gallery-sheet-demo';
