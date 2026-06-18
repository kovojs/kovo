// @kovojs-ir - lowered from examples/gallery/src/interactive/tooltip-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryTooltipDemo$button_aria_describedby_derive = derive(['state'], (state: any) =>
  state.open ? 'gallery-tooltip-content' : null,
);
export const GalleryTooltipDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryTooltipDemo$span_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryTooltipDemo$span_hidden_derive = derive(['state'], (state: any) =>
  !state.open ? '' : null,
);
export const GalleryTooltipDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import {
  tooltipContentAttributes,
  tooltipRootAttributes,
  tooltipTriggerAttributes,
} from '@kovojs/headless-ui/tooltip';
import { tooltipClasses, tooltipTriggerClasses, tooltipContentClasses } from '@kovojs/ui/tooltip';

const ROOT_CLASS = tooltipClasses.join(' ');
const TRIGGER_CLASS = tooltipTriggerClasses.join(' ');
const CONTENT_CLASS = tooltipContentClasses.join(' ');

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
      <section
        {...tooltipRootAttributes({ open: state.open })}
        class={ROOT_CLASS}
        data-gallery-interactive="tooltip"
        kovo-c="gallery-tooltip-demo"
        kovo-state='{"open":false}'
      >
        <button
          class={TRIGGER_CLASS}
          on:blur="/c/__v/fcc3e50c/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$button_blur"
          on:focus="/c/__v/fcc3e50c/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$button_focus"
          on:keydown="/c/__v/fcc3e50c/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$button_keydown"
          on:pointerenter="/c/__v/fcc3e50c/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$button_pointerenter"
          on:pointerleave="/c/__v/fcc3e50c/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$button_pointerleave"
          {...tooltipTriggerAttributes({ contentId, open: state.open })}
          aria-describedby={state.open ? 'gallery-tooltip-content' : null}
          data-bind:aria-describedby="/c/__v/fcc3e50c/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$button_aria_describedby_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/fcc3e50c/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$button_data_state_derive"
        >
          Shipping code
        </button>
        <span
          class={CONTENT_CLASS}
          {...tooltipContentAttributes({ contentId, open: state.open })}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/fcc3e50c/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$span_data_state_derive"
          hidden={!state.open}
          data-bind:hidden="/c/__v/fcc3e50c/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$span_hidden_derive"
        >
          Use the code printed on the packing slip.
        </span>
        <output
          data-demo-state="tooltip-open"
          data-bind="/c/__v/fcc3e50c/examples/gallery/src/generated/interactive/tooltip-demo.client.js#GalleryTooltipDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </section>
    );
  },
});
GalleryTooltipDemo.name = 'generated/interactive/tooltip-demo/gallery-tooltip-demo';
