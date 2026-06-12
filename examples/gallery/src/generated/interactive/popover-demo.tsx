// @jiso-ir - lowered from examples/gallery/src/interactive/popover-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  popoverContentAttributes,
  popoverRootAttributes,
  popoverTriggerAttributes,
} from '@jiso/headless-ui/primitives';

export interface GalleryPopoverDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryPopoverDemo = component('gallery-popover-demo', {
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryPopoverDemoState) => {
    const contentId = 'gallery-popover-content';

    return (
      <section
        {...popoverRootAttributes({ open: state.open })}
        class="grid gap-2"
        data-gallery-interactive="popover"
        fw-c="gallery-popover-demo"
        fw-state='{"open":false}'
      >
        <button
          {...popoverTriggerAttributes({ contentId, open: state.open })}
          on:click="/c/examples/gallery/src/generated/interactive/popover-demo.client.js?v=311cf8e1#GalleryPopoverDemo$button_click"
        >
          Delivery window
        </button>
        <div {...popoverContentAttributes({ contentId, open: state.open })}>
          Weekday arrivals are available from 9 AM to 5 PM.
        </div>
      </section>
    );
  },
});
