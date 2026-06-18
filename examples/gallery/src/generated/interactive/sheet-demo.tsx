// @kovojs-ir - lowered from examples/gallery/src/interactive/sheet-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GallerySheetDemo$section_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GallerySheetDemo$button_aria_expanded_derive = derive(['state'], (state: any) =>
  state.open ? 'true' : 'false',
);
export const GallerySheetDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GallerySheetDemo$dialog_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GallerySheetDemo$dialog_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GallerySheetDemo$button_data_state_derive_2 = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GallerySheetDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import {
  dialogCloseAttributes,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerAttributes,
} from '@kovojs/headless-ui/dialog';
import {
  sheetTriggerClasses,
  sheetContentClasses,
  sheetHeaderClasses,
  sheetTitleClasses,
  sheetDescriptionClasses,
  sheetCloseClasses,
} from '@kovojs/ui/sheet';

// CONTENT_CLASS is sheetContentClassNames base + the `right` side variant.
const TRIGGER_CLASS = sheetTriggerClasses.join(' ');
const CONTENT_CLASS = sheetContentClasses.join(' ');
const HEADER_CLASS = sheetHeaderClasses.join(' ');
const TITLE_CLASS = sheetTitleClasses.join(' ');
const DESCRIPTION_CLASS = sheetDescriptionClasses.join(' ');
const CLOSE_CLASS = sheetCloseClasses.join(' ');

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
      <section
        class="grid gap-2"
        data-gallery-interactive="sheet"
        data-side="right"
        {...dialogRootAttributes({ open: state.open })}
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/071745a7/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$section_data_state_derive"
        kovo-c="gallery-sheet-demo"
        kovo-state='{"open":false}'
      >
        <button
          class={TRIGGER_CLASS}
          on:click="/c/__v/071745a7/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$button_click"
          {...dialogTriggerAttributes({ contentId, open: state.open })}
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/__v/071745a7/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$button_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/071745a7/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$button_data_state_derive"
        >
          Open sheet
        </button>
        <dialog
          class={CONTENT_CLASS}
          data-side="right"
          on:cancel="/c/__v/071745a7/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$dialog_cancel"
          {...dialogContentAttributes({ contentId, descriptionId, open: state.open, titleId })}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/071745a7/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$dialog_data_state_derive"
          open={state.open}
          data-bind:open="/c/__v/071745a7/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$dialog_open_derive"
        >
          <header class={HEADER_CLASS}>
            <h2 class={TITLE_CLASS} id={titleId}>
              Account settings
            </h2>
            <p class={DESCRIPTION_CLASS} id={descriptionId}>
              Review the account panel side sheet.
            </p>
          </header>
          <button
            class={CLOSE_CLASS}
            on:click="/c/__v/071745a7/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$button_click_2"
            {...dialogCloseAttributes({ contentId, open: state.open })}
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/__v/071745a7/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$button_data_state_derive_2"
          >
            Close sheet
          </button>
        </dialog>
        <output
          data-demo-state="sheet-open"
          data-bind="/c/__v/071745a7/examples/gallery/src/generated/interactive/sheet-demo.client.js#GallerySheetDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </section>
    );
  },
});
GallerySheetDemo.name = 'generated/interactive/sheet-demo/gallery-sheet-demo';
