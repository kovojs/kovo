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
      >
        <button
          {...alertDialogTriggerAttributes({ contentId, open: state.open })}
          onClick={() => {
            state.open = true;
          }}
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
        >
          <h2 id={titleId}>Delete workspace?</h2>
          <p id={descriptionId}>This removes the shared gallery workspace for every member.</p>
          <button
            {...alertDialogCancelAttributes({ autoFocus: true, contentId, open: state.open })}
            onClick={() => {
              state.open = false;
            }}
          >
            Keep workspace
          </button>
          <button
            {...alertDialogActionAttributes({
              contentId,
              intent: 'destructive',
              open: state.open,
            })}
            onClick={() => {
              state.open = false;
            }}
          >
            Delete
          </button>
        </dialog>
        <output data-demo-state="alert-dialog-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
