// @kovojs-ir - lowered from examples/gallery/src/interactive/hover-card-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryHoverCardDemo$section_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryHoverCardDemo$a_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryHoverCardDemo$aside_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryHoverCardDemo$aside_hidden_derive = derive(['state'], (state: any) =>
  !state.open ? '' : null,
);
export const GalleryHoverCardDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import {
  hoverCardContentAttributes,
  hoverCardRootAttributes,
  hoverCardTriggerAttributes,
} from '@kovojs/headless-ui/hover-card';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/hover-card.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const ROOT_CLASS = 'relative inline-block text-sm text-neutral-950 data-[disabled]:opacity-50';
const TRIGGER_CLASS =
  'inline-flex items-center rounded-md text-sm font-medium text-neutral-950 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 data-[state=open]:underline';
const CONTENT_CLASS =
  'mt-2 w-72 rounded-md border border-neutral-200 bg-white p-4 text-sm text-neutral-700 shadow-md data-[state=closed]:hidden';

export interface GalleryHoverCardDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryHoverCardDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryHoverCardDemoState) => {
    const contentId = 'gallery-hover-card-content';

    return (
      <section
        class={ROOT_CLASS}
        data-gallery-interactive="hover-card"
        {...hoverCardRootAttributes({ open: state.open })}
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/9b8ca871/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$section_data_state_derive"
        kovo-c="gallery-hover-card-demo"
        kovo-state='{"open":false}'
      >
        <a
          class={TRIGGER_CLASS}
          href="#hover-card-demo"
          on:blur="/c/__v/9b8ca871/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$a_blur"
          on:focus="/c/__v/9b8ca871/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$a_focus"
          on:keydown="/c/__v/9b8ca871/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$a_keydown"
          on:pointerenter="/c/__v/9b8ca871/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$a_pointerenter"
          on:pointerleave="/c/__v/9b8ca871/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$a_pointerleave"
          {...hoverCardTriggerAttributes({ contentId, open: state.open })}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/9b8ca871/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$a_data_state_derive"
        >
          Ada Lovelace
        </a>
        <aside
          class={CONTENT_CLASS}
          on:pointerenter="/c/__v/9b8ca871/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$aside_pointerenter"
          on:pointerleave="/c/__v/9b8ca871/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$aside_pointerleave"
          {...hoverCardContentAttributes({ contentId, open: state.open })}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/9b8ca871/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$aside_data_state_derive"
          hidden={!state.open}
          data-bind:hidden="/c/__v/9b8ca871/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$aside_hidden_derive"
        >
          First programmer and analytical engine collaborator.
        </aside>
        <output
          data-demo-state="hover-card-open"
          data-bind="/c/__v/9b8ca871/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </section>
    );
  },
});
GalleryHoverCardDemo.name = 'generated/interactive/hover-card-demo/gallery-hover-card-demo';
