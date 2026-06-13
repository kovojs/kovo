/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  dialogCloseAttributes,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerAttributes,
} from '@jiso/headless-ui/primitives';

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
        onKeyDown={() => {
          state.open = false;
        }}
      >
        <button
          {...dialogTriggerAttributes({ contentId, open: state.open })}
          onClick={() => {
            state.open = true;
          }}
        >
          Open sheet
        </button>
        <dialog
          {...dialogContentAttributes({ contentId, descriptionId, open: state.open, titleId })}
          data-side="right"
          onCancel={() => {
            state.open = false;
          }}
        >
          <h2 id={titleId}>Account settings</h2>
          <p id={descriptionId}>Review the account panel side sheet.</p>
          <button
            {...dialogCloseAttributes({ contentId, open: state.open })}
            onClick={() => {
              state.open = false;
            }}
          >
            Close sheet
          </button>
        </dialog>
        <output data-demo-state="sheet-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
