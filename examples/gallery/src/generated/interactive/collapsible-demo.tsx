// @jiso-ir - lowered from examples/gallery/src/interactive/collapsible-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  collapsibleContentAttributes,
  collapsibleRootAttributes,
  collapsibleTriggerAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/collapsible.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS =
  'rounded-md border border-neutral-200 bg-white text-sm text-neutral-950 data-[disabled]:opacity-50';
const TRIGGER_CLASS =
  'cursor-pointer px-3 py-2 font-medium text-neutral-950 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 data-[state=open]:bg-neutral-50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50';
const CONTENT_CLASS = 'px-3 pb-3 text-sm text-neutral-700 data-[state=closed]:hidden';

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
        class={ROOT_CLASS}
        data-gallery-interactive="collapsible"
        fw-c="gallery-collapsible-demo"
        fw-state='{"open":false}'
      >
        <summary
          {...collapsibleTriggerAttributes({ contentId, open: state.open })}
          class={TRIGGER_CLASS}
          on:click="/c/examples/gallery/src/generated/interactive/collapsible-demo.client.js?v=65e15314#GalleryCollapsibleDemo$summary_click"
        >
          Release notes
        </summary>
        <div
          {...collapsibleContentAttributes({ contentId, open: state.open })}
          class={CONTENT_CLASS}
        >
          Added browser-backed compiled coverage.
        </div>
      </details>
    );
  },
});
