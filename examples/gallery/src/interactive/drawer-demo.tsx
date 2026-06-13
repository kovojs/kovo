/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  dialogCloseAttributes,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerAttributes,
} from '@jiso/headless-ui/primitives';

export interface GalleryDrawerDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryDrawerDemo = component('gallery-drawer-demo', {
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryDrawerDemoState) => {
    const contentId = 'gallery-interactive-drawer-content';
    const titleId = 'gallery-interactive-drawer-title';
    const descriptionId = 'gallery-interactive-drawer-description';

    return (
      <section
        {...dialogRootAttributes({ open: state.open })}
        class="grid gap-2"
        data-gallery-interactive="drawer"
        data-side="bottom"
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
          Open drawer
        </button>
        <dialog
          {...dialogContentAttributes({ contentId, descriptionId, open: state.open, titleId })}
          data-side="bottom"
          onCancel={() => {
            state.open = false;
          }}
        >
          <h2 id={titleId}>Mobile actions</h2>
          <p id={descriptionId}>Choose a bulk action without leaving the current page.</p>
          <button
            {...dialogCloseAttributes({ contentId, open: state.open })}
            onClick={() => {
              state.open = false;
            }}
          >
            Close drawer
          </button>
        </dialog>
        <output data-demo-state="drawer-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
