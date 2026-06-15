// @jiso-ir - lowered from examples/gallery/src/interactive/hover-card-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { derive } from '@jiso/runtime';

export const GalleryHoverCardDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@jiso/core';
import {
  hoverCardContentAttributes,
  hoverCardRootAttributes,
  hoverCardTriggerAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/hover-card.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS = 'relative inline-block text-sm text-neutral-950 data-[disabled]:opacity-50';
const TRIGGER_CLASS =
  'inline-flex items-center rounded-md text-sm font-medium text-neutral-950 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 data-[state=open]:underline';
const CONTENT_CLASS =
  'mt-2 w-72 rounded-md border border-neutral-200 bg-white p-4 text-sm text-neutral-700 shadow-md data-[state=closed]:hidden';

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
        class={ROOT_CLASS}
        data-gallery-interactive="hover-card"
        fw-c="gallery-hover-card-demo"
        fw-state='{"open":false}'
      >
        <a
          {...hoverCardTriggerAttributes({ contentId, open: state.open })}
          class={TRIGGER_CLASS}
          href="#hover-card-demo"
          on:blur="/c/examples/gallery/src/generated/interactive/hover-card-demo.client.js?v=21b2101d#GalleryHoverCardDemo$a_blur"
          on:focus="/c/examples/gallery/src/generated/interactive/hover-card-demo.client.js?v=21b2101d#GalleryHoverCardDemo$a_focus"
          on:keydown="/c/examples/gallery/src/generated/interactive/hover-card-demo.client.js?v=21b2101d#GalleryHoverCardDemo$a_keydown"
          on:pointerenter="/c/examples/gallery/src/generated/interactive/hover-card-demo.client.js?v=21b2101d#GalleryHoverCardDemo$a_pointerenter"
          on:pointerleave="/c/examples/gallery/src/generated/interactive/hover-card-demo.client.js?v=21b2101d#GalleryHoverCardDemo$a_pointerleave"
        >
          Ada Lovelace
        </a>
        <aside
          {...hoverCardContentAttributes({ contentId, open: state.open })}
          class={CONTENT_CLASS}
        >
          First programmer and analytical engine collaborator.
        </aside>
        <output
          data-demo-state="hover-card-open"
          data-bind="/c/examples/gallery/src/generated/interactive/hover-card-demo.client.js?v=21b2101d#GalleryHoverCardDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </section>
    );
  },
});
