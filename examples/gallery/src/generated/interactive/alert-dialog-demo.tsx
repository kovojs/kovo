// @jiso-ir - lowered from examples/gallery/src/interactive/alert-dialog-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { derive } from '@jiso/runtime';

export const GalleryAlertDialogDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@jiso/core';
import {
  alertDialogActionAttributes,
  alertDialogCancelAttributes,
  alertDialogContentAttributes,
  alertDialogRootAttributes,
  alertDialogTriggerAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/alert-dialog.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const TRIGGER_CLASS =
  'inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50';
const CONTENT_CLASS =
  'm-auto max-w-md rounded-lg border border-neutral-200 bg-white p-6 text-neutral-950 shadow-xl backdrop:bg-black/40 data-[state=closed]:hidden';
const CANCEL_CLASS =
  'inline-flex h-8 items-center justify-center rounded-md border border-neutral-300 bg-white px-2.5 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50';
const ACTION_CLASS =
  'inline-flex h-8 items-center justify-center rounded-md border border-transparent bg-neutral-950 px-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50 data-[intent=destructive]:bg-red-600 data-[intent=destructive]:hover:bg-red-700';
const TITLE_CLASS = 'text-base font-semibold';
const DESCRIPTION_CLASS = 'text-sm text-neutral-600';

export interface GalleryAlertDialogDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryAlertDialogDemo = component('gallery-alert-dialog-demo', {
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryAlertDialogDemoState) => {
    const contentId = 'gallery-interactive-alert-dialog-content';
    const titleId = 'gallery-interactive-alert-dialog-title';
    const descriptionId = 'gallery-interactive-alert-dialog-description';

    return (
      <section
        {...alertDialogRootAttributes({ open: state.open })}
        class="grid gap-2"
        data-gallery-interactive="alert-dialog"
        on:keydown="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=96e20a46#GalleryAlertDialogDemo$section_keydown"
        fw-c="gallery-alert-dialog-demo"
        fw-state='{"open":false}'
      >
        <button
          {...alertDialogTriggerAttributes({ contentId, open: state.open })}
          class={TRIGGER_CLASS}
          on:click="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=96e20a46#GalleryAlertDialogDemo$button_click"
        >
          Delete workspace
        </button>
        <dialog
          {...alertDialogContentAttributes({
            contentId,
            descriptionId,
            open: state.open,
            titleId,
          })}
          class={CONTENT_CLASS}
          on:cancel="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=96e20a46#GalleryAlertDialogDemo$dialog_cancel"
        >
          <h2 class={TITLE_CLASS} id={titleId}>
            Delete workspace?
          </h2>
          <p class={DESCRIPTION_CLASS} id={descriptionId}>
            This removes the shared gallery workspace for every member.
          </p>
          <button
            {...alertDialogCancelAttributes({ autoFocus: true, contentId, open: state.open })}
            class={CANCEL_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=96e20a46#GalleryAlertDialogDemo$button_click_2"
          >
            Keep workspace
          </button>
          <button
            {...alertDialogActionAttributes({
              contentId,
              intent: 'destructive',
              open: state.open,
            })}
            class={ACTION_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=96e20a46#GalleryAlertDialogDemo$button_click_3"
          >
            Delete
          </button>
        </dialog>
        <output
          data-demo-state="alert-dialog-open"
          data-bind="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=96e20a46#GalleryAlertDialogDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </section>
    );
  },
});
