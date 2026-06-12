// @jiso-ir - lowered from examples/gallery/src/interactive/tooltip-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  tooltipContentAttributes,
  tooltipRootAttributes,
  tooltipTriggerAttributes,
} from '@jiso/headless-ui/primitives';

export interface GalleryTooltipDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryTooltipDemo = component('gallery-tooltip-demo', {
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryTooltipDemoState) => {
    const contentId = 'gallery-tooltip-content';

    return (
      <section
        {...tooltipRootAttributes({ open: state.open })}
        class="inline-grid gap-2"
        data-gallery-interactive="tooltip"
        fw-c="gallery-tooltip-demo"
        fw-state='{"open":false}'
      >
        <button
          {...tooltipTriggerAttributes({ contentId, open: state.open })}
          on:blur="/c/examples/gallery/src/generated/interactive/tooltip-demo.client.js?v=294f0bc3#GalleryTooltipDemo$button_blur"
          on:focus="/c/examples/gallery/src/generated/interactive/tooltip-demo.client.js?v=294f0bc3#GalleryTooltipDemo$button_focus"
          on:keydown="/c/examples/gallery/src/generated/interactive/tooltip-demo.client.js?v=294f0bc3#GalleryTooltipDemo$button_keydown"
          on:pointerenter="/c/examples/gallery/src/generated/interactive/tooltip-demo.client.js?v=294f0bc3#GalleryTooltipDemo$button_pointerenter"
          on:pointerleave="/c/examples/gallery/src/generated/interactive/tooltip-demo.client.js?v=294f0bc3#GalleryTooltipDemo$button_pointerleave"
        >
          Shipping code
        </button>
        <span {...tooltipContentAttributes({ contentId, open: state.open })}>
          Use the code printed on the packing slip.
        </span>
        <output data-demo-state="tooltip-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
