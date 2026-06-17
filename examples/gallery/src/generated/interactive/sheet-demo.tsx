// @kovojs-ir - lowered from examples/gallery/src/interactive/sheet-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime';

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
  dialogCancel as _dialogCancel,
  dialogCloseAttributes,
  dialogCloseClick as _dialogCloseClick,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerClick as _dialogTriggerClick,
  dialogTriggerAttributes,
} from '@kovojs/headless-ui/primitives';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/sheet.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
// CONTENT_CLASS is sheetContentClassNames base + the `right` side variant.
const TRIGGER_CLASS =
  'inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-50';
const CONTENT_CLASS =
  'fixed z-50 flex flex-col gap-4 border-neutral-200 bg-white p-6 text-neutral-950 shadow-xl inset-y-0 right-0 w-full max-w-sm border-l';
const HEADER_CLASS = 'grid gap-1';
const TITLE_CLASS = 'text-base font-semibold';
const DESCRIPTION_CLASS = 'text-sm text-neutral-600';
const CLOSE_CLASS =
  'inline-flex h-8 w-fit items-center justify-center rounded-md border border-neutral-300 bg-white px-2.5 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-50';

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
        data-bind:data-state="/c/examples/gallery/src/generated/interactive/sheet-demo.client.js?v=d18e3e9f#GallerySheetDemo$section_data_state_derive"
        kovo-c="gallery-sheet-demo"
        kovo-state='{"open":false}'
      >
        <button
          class={TRIGGER_CLASS}
          on:click="/c/examples/gallery/src/generated/interactive/sheet-demo.client.js?v=d18e3e9f#GallerySheetDemo$button_click"
          {...dialogTriggerAttributes({ contentId, open: state.open })}
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/examples/gallery/src/generated/interactive/sheet-demo.client.js?v=d18e3e9f#GallerySheetDemo$button_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/sheet-demo.client.js?v=d18e3e9f#GallerySheetDemo$button_data_state_derive"
        >
          Open sheet
        </button>
        <dialog
          class={CONTENT_CLASS}
          data-side="right"
          on:cancel="/c/examples/gallery/src/generated/interactive/sheet-demo.client.js?v=d18e3e9f#GallerySheetDemo$dialog_cancel"
          {...dialogContentAttributes({ contentId, descriptionId, open: state.open, titleId })}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/sheet-demo.client.js?v=d18e3e9f#GallerySheetDemo$dialog_data_state_derive"
          open={state.open}
          data-bind:open="/c/examples/gallery/src/generated/interactive/sheet-demo.client.js?v=d18e3e9f#GallerySheetDemo$dialog_open_derive"
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
            on:click="/c/examples/gallery/src/generated/interactive/sheet-demo.client.js?v=d18e3e9f#GallerySheetDemo$button_click_2"
            {...dialogCloseAttributes({ contentId, open: state.open })}
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/sheet-demo.client.js?v=d18e3e9f#GallerySheetDemo$button_data_state_derive_2"
          >
            Close sheet
          </button>
        </dialog>
        <output
          data-demo-state="sheet-open"
          data-bind="/c/examples/gallery/src/generated/interactive/sheet-demo.client.js?v=d18e3e9f#GallerySheetDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </section>
    );
  },
});
GallerySheetDemo.name = 'generated/interactive/sheet-demo/gallery-sheet-demo';
