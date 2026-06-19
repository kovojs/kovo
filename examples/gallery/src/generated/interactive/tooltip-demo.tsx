// @kovojs-ir - lowered from examples/gallery/src/interactive/tooltip-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryTooltipDemo$Tooltip_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryTooltipDemo$TooltipTrigger_aria_describedby_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'gallery-tooltip-content' : null),
);
export const GalleryTooltipDemo$TooltipTrigger_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryTooltipDemo$TooltipContent_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryTooltipDemo$Tooltip_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryTooltipDemo$TooltipTrigger_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryTooltipDemo$TooltipContent_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryTooltipDemo$TooltipContent_hidden_derive = derive(['state'], (state: any) =>
  state.open ? null : '',
);
export const GalleryTooltipDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import { Tooltip, TooltipContent, TooltipTrigger } from '@kovojs/ui/tooltip';

export interface GalleryTooltipDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryTooltipDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryTooltipDemoState) => {
    const contentId = 'gallery-tooltip-content';

    return (
      <Tooltip
        data-gallery-interactive="tooltip"
        open={state.open}
        data-bind:open="/c/__v/8e82e452/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$Tooltip_open_derive"
        data-bind:data-state="/c/__v/8e82e452/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$Tooltip_data_state_derive"
        kovo-state='{"open":false}'
      >
        <TooltipTrigger
          contentId={contentId}
          on:blur="/c/__v/8e82e452/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$TooltipTrigger_blur"
          on:focus="/c/__v/8e82e452/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$TooltipTrigger_focus"
          on:keydown="/c/__v/8e82e452/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$TooltipTrigger_keydown"
          on:pointerenter="/c/__v/8e82e452/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$TooltipTrigger_pointerenter"
          on:pointerleave="/c/__v/8e82e452/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$TooltipTrigger_pointerleave"
          aria-describedby={state.open ? 'gallery-tooltip-content' : null}
          data-bind:aria-describedby="/c/__v/8e82e452/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$TooltipTrigger_aria_describedby_derive"
          open={state.open}
          data-bind:open="/c/__v/8e82e452/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$TooltipTrigger_open_derive"
          data-bind:data-state="/c/__v/8e82e452/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$TooltipTrigger_data_state_derive"
        >
          Shipping code
        </TooltipTrigger>
        <TooltipContent
          contentId={contentId}
          open={state.open}
          data-bind:open="/c/__v/8e82e452/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$TooltipContent_open_derive"
          data-bind:data-state="/c/__v/8e82e452/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$TooltipContent_data_state_derive"
          data-bind:hidden="/c/__v/8e82e452/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$TooltipContent_hidden_derive"
        >
          Use the code printed on the packing slip.
        </TooltipContent>
        <output
          data-demo-state="tooltip-open"
          data-bind="/c/__v/8e82e452/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </Tooltip>
    );
  },
});
GalleryTooltipDemo.name = 'generated/interactive/tooltip-demo/gallery-tooltip-demo';
