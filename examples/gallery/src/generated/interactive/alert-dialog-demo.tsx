// @jiso-ir - lowered from examples/gallery/src/interactive/alert-dialog-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  alertDialogActionAttributes,
  alertDialogCancelAttributes,
  alertDialogContentAttributes,
  alertDialogRootAttributes,
  alertDialogTriggerAttributes,
} from '@jiso/headless-ui/primitives';

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
        on:keydown="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=b4376c40#GalleryAlertDialogDemo$section_keydown"
        fw-c="gallery-alert-dialog-demo"
        fw-state='{"open":false}'
      >
        <button
          {...alertDialogTriggerAttributes({ contentId, open: state.open })}
          on:click="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=b4376c40#GalleryAlertDialogDemo$button_click"
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
          on:cancel="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=b4376c40#GalleryAlertDialogDemo$dialog_cancel"
        >
          <h2 id={titleId}>Delete workspace?</h2>
          <p id={descriptionId}>This removes the shared gallery workspace for every member.</p>
          <button
            {...alertDialogCancelAttributes({ autoFocus: true, contentId, open: state.open })}
            on:click="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=b4376c40#GalleryAlertDialogDemo$button_click_2"
          >
            Keep workspace
          </button>
          <button
            {...alertDialogActionAttributes({
              contentId,
              intent: 'destructive',
              open: state.open,
            })}
            on:click="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=b4376c40#GalleryAlertDialogDemo$button_click_3"
          >
            Delete
          </button>
        </dialog>
        <output data-demo-state="alert-dialog-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
