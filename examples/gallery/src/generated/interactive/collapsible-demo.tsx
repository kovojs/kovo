// @jiso-ir - lowered from examples/gallery/src/interactive/collapsible-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  collapsibleContentAttributes,
  collapsibleRootAttributes,
  collapsibleTriggerAttributes,
} from '@jiso/headless-ui/primitives';

export interface GalleryCollapsibleDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryCollapsibleDemo = component('gallery-collapsible-demo', {
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryCollapsibleDemoState) => {
    const contentId = 'gallery-collapsible-content';

    return (
      <details
        {...collapsibleRootAttributes({ open: state.open })}
        class="grid gap-2"
        data-gallery-interactive="collapsible"
        fw-c="gallery-collapsible-demo"
        fw-state='{"open":false}'
      >
        <summary
          {...collapsibleTriggerAttributes({ contentId, open: state.open })}
          on:click="/c/examples/gallery/src/generated/interactive/collapsible-demo.client.js?v=65e15314#GalleryCollapsibleDemo$summary_click"
        >
          Release notes
        </summary>
        <div {...collapsibleContentAttributes({ contentId, open: state.open })}>
          Added browser-backed compiled coverage.
        </div>
      </details>
    );
  },
});
