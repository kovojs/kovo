// @kovojs-ir - lowered from examples/gallery/src/interactive/hover-card-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryHoverCardDemo$HoverCard_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryHoverCardDemo$HoverCard_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryHoverCardDemo$HoverCardTrigger_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryHoverCardDemo$HoverCardTrigger_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryHoverCardDemo$HoverCardContent_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryHoverCardDemo$HoverCardContent_hidden_derive = derive(['state'], (state: any) =>
  !state.open ? '' : null,
);
export const GalleryHoverCardDemo$HoverCardContent_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryHoverCardDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@kovojs/ui/hover-card';

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
      <HoverCard
        data-gallery-interactive="hover-card"
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/a0dcd8a3/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$HoverCard_data_state_derive"
        open={state.open}
        data-bind:open="/c/__v/a0dcd8a3/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$HoverCard_open_derive"
        kovo-state='{"open":false}'
      >
        <HoverCardTrigger
          contentId={contentId}
          href="#hover-card-demo"
          on:blur="/c/__v/a0dcd8a3/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$HoverCardTrigger_blur"
          on:focus="/c/__v/a0dcd8a3/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$HoverCardTrigger_focus"
          on:keydown="/c/__v/a0dcd8a3/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$HoverCardTrigger_keydown"
          on:pointerenter="/c/__v/a0dcd8a3/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$HoverCardTrigger_pointerenter"
          on:pointerleave="/c/__v/a0dcd8a3/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$HoverCardTrigger_pointerleave"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/a0dcd8a3/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$HoverCardTrigger_data_state_derive"
          open={state.open}
          data-bind:open="/c/__v/a0dcd8a3/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$HoverCardTrigger_open_derive"
        >
          Ada Lovelace
        </HoverCardTrigger>
        <HoverCardContent
          contentId={contentId}
          on:pointerenter="/c/__v/a0dcd8a3/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$HoverCardContent_pointerenter"
          on:pointerleave="/c/__v/a0dcd8a3/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$HoverCardContent_pointerleave"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/a0dcd8a3/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$HoverCardContent_data_state_derive"
          hidden={!state.open}
          data-bind:hidden="/c/__v/a0dcd8a3/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$HoverCardContent_hidden_derive"
          open={state.open}
          data-bind:open="/c/__v/a0dcd8a3/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$HoverCardContent_open_derive"
        >
          First programmer and analytical engine collaborator.
        </HoverCardContent>
        <output
          data-demo-state="hover-card-open"
          data-bind="/c/__v/a0dcd8a3/examples/gallery/src/generated/interactive/hover-card-demo.client.js#GalleryHoverCardDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </HoverCard>
    );
  },
});
GalleryHoverCardDemo.name = 'generated/interactive/hover-card-demo/gallery-hover-card-demo';
