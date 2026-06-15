// @jiso-ir - lowered from examples/gallery/src/interactive/sheet-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { derive } from '@jiso/runtime';

export const GallerySheetDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@jiso/core';
import {
  dialogCloseAttributes,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/sheet.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
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
// generated artifacts prove the gallery path is compiled through Jiso.
export const GallerySheetDemo = component('gallery-sheet-demo', {
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GallerySheetDemoState) => {
    const contentId = 'gallery-interactive-sheet-content';
    const titleId = 'gallery-interactive-sheet-title';
    const descriptionId = 'gallery-interactive-sheet-description';

    return (
      <section
        {...dialogRootAttributes({ open: state.open })}
        class="grid gap-2"
        data-gallery-interactive="sheet"
        data-side="right"
        on:keydown="/c/examples/gallery/src/generated/interactive/sheet-demo.client.js?v=18d13341#GallerySheetDemo$section_keydown"
        fw-c="gallery-sheet-demo"
        fw-state='{"open":false}'
      >
        <button
          {...dialogTriggerAttributes({ contentId, open: state.open })}
          class={TRIGGER_CLASS}
          on:click="/c/examples/gallery/src/generated/interactive/sheet-demo.client.js?v=18d13341#GallerySheetDemo$button_click"
        >
          Open sheet
        </button>
        <dialog
          {...dialogContentAttributes({ contentId, descriptionId, open: state.open, titleId })}
          class={CONTENT_CLASS}
          data-side="right"
          on:cancel="/c/examples/gallery/src/generated/interactive/sheet-demo.client.js?v=18d13341#GallerySheetDemo$dialog_cancel"
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
            {...dialogCloseAttributes({ contentId, open: state.open })}
            class={CLOSE_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/sheet-demo.client.js?v=18d13341#GallerySheetDemo$button_click_2"
          >
            Close sheet
          </button>
        </dialog>
        <output
          data-demo-state="sheet-open"
          data-bind="/c/examples/gallery/src/generated/interactive/sheet-demo.client.js?v=18d13341#GallerySheetDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </section>
    );
  },
});
