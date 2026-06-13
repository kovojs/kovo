// @jiso-ir - lowered from examples/gallery/src/interactive/drawer-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
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
        on:keydown="/c/examples/gallery/src/generated/interactive/drawer-demo.client.js?v=748c48b8#GalleryDrawerDemo$section_keydown"
        fw-c="gallery-drawer-demo"
        fw-state='{"open":false}'
      >
        <button
          {...dialogTriggerAttributes({ contentId, open: state.open })}
          on:click="/c/examples/gallery/src/generated/interactive/drawer-demo.client.js?v=748c48b8#GalleryDrawerDemo$button_click"
        >
          Open drawer
        </button>
        <dialog
          {...dialogContentAttributes({ contentId, descriptionId, open: state.open, titleId })}
          data-side="bottom"
          on:cancel="/c/examples/gallery/src/generated/interactive/drawer-demo.client.js?v=748c48b8#GalleryDrawerDemo$dialog_cancel"
        >
          <h2 id={titleId}>Mobile actions</h2>
          <p id={descriptionId}>Choose a bulk action without leaving the current page.</p>
          <button
            {...dialogCloseAttributes({ contentId, open: state.open })}
            on:click="/c/examples/gallery/src/generated/interactive/drawer-demo.client.js?v=748c48b8#GalleryDrawerDemo$button_click_2"
          >
            Close drawer
          </button>
        </dialog>
        <output data-demo-state="drawer-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
