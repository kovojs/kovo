/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  dialogCloseAttributes,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerAttributes,
} from '@jiso/headless-ui/primitives';

export interface GalleryDialogDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryDialogDemo = component('gallery-dialog-demo', {
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryDialogDemoState) => {
    const contentId = 'gallery-dialog-content';
    const titleId = 'gallery-dialog-title';
    const descriptionId = 'gallery-dialog-description';

    return (
      <section
        {...dialogRootAttributes({ open: state.open })}
        class="grid gap-2"
        data-gallery-interactive="dialog"
      >
        <button
          {...dialogTriggerAttributes({ contentId, open: state.open })}
          onClick={() => {
            state.open = true;
          }}
        >
          Review cart
        </button>
        <dialog
          {...dialogContentAttributes({ contentId, descriptionId, open: state.open, titleId })}
        >
          <h2 id={titleId}>Cart review</h2>
          <p id={descriptionId}>Confirm the current cart before checkout.</p>
          <button
            {...dialogCloseAttributes({ contentId, open: state.open })}
            onClick={() => {
              state.open = false;
            }}
          >
            Close review
          </button>
        </dialog>
        <output data-demo-state="open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
