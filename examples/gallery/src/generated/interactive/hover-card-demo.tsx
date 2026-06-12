// @jiso-ir - lowered from examples/gallery/src/interactive/hover-card-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  hoverCardContentAttributes,
  hoverCardRootAttributes,
  hoverCardTriggerAttributes,
} from '@jiso/headless-ui/primitives';

export interface GalleryHoverCardDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryHoverCardDemo = component('gallery-hover-card-demo', {
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryHoverCardDemoState) => {
    const contentId = 'gallery-hover-card-content';

    return (
      <section
        {...hoverCardRootAttributes({ open: state.open })}
        class="inline-grid gap-2"
        data-gallery-interactive="hover-card"
        fw-c="gallery-hover-card-demo"
        fw-state='{"open":false}'
      >
        <a
          {...hoverCardTriggerAttributes({ contentId, open: state.open })}
          href="/authors/ada"
          on:blur="/c/examples/gallery/src/generated/interactive/hover-card-demo.client.js?v=b01f35f3#GalleryHoverCardDemo$a_blur"
          on:focus="/c/examples/gallery/src/generated/interactive/hover-card-demo.client.js?v=b01f35f3#GalleryHoverCardDemo$a_focus"
          on:keydown="/c/examples/gallery/src/generated/interactive/hover-card-demo.client.js?v=b01f35f3#GalleryHoverCardDemo$a_keydown"
          on:pointerenter="/c/examples/gallery/src/generated/interactive/hover-card-demo.client.js?v=b01f35f3#GalleryHoverCardDemo$a_pointerenter"
          on:pointerleave="/c/examples/gallery/src/generated/interactive/hover-card-demo.client.js?v=b01f35f3#GalleryHoverCardDemo$a_pointerleave"
        >
          Ada Lovelace
        </a>
        <aside {...hoverCardContentAttributes({ contentId, open: state.open })}>
          First programmer and analytical engine collaborator.
        </aside>
        <output data-demo-state="hover-card-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
