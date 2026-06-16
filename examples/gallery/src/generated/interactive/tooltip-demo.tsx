// @kovojs-ir - lowered from examples/gallery/src/interactive/tooltip-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime';

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
  tooltipEscapeKeyDown as _tooltipEscapeKeyDown,
  tooltipRootAttributes,
  tooltipTriggerAttributes,
  tooltipTriggerBlur as _tooltipTriggerBlur,
  tooltipTriggerFocus as _tooltipTriggerFocus,
  tooltipTriggerPointerEnter as _tooltipTriggerPointerEnter,
  tooltipTriggerPointerLeave as _tooltipTriggerPointerLeave,
} from '@kovojs/headless-ui/primitives';

// Tailwind classes mirror the @kovojs/ui styled layer (packages/ui/src/tooltip.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS = 'relative inline-block text-sm text-neutral-950 data-[disabled]:opacity-50';
const TRIGGER_CLASS =
  'inline-flex h-8 items-center justify-center rounded-md border border-neutral-300 bg-white px-2.5 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 data-[state=open]:bg-neutral-100';
const CONTENT_CLASS =
  'mt-2 w-max max-w-64 rounded-md bg-neutral-950 px-2.5 py-1.5 text-xs text-white shadow-md data-[state=closed]:hidden';

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
          {...tooltipTriggerAttributes({ contentId, open: state.open })}
          class={TRIGGER_CLASS}
          aria-describedby={state.open ? 'gallery-tooltip-content' : null}
          data-bind:aria-describedby="/c/examples/gallery/src/generated/interactive/tooltip-demo.client.js?v=52d827a7#GalleryTooltipDemo$button_aria_describedby_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/tooltip-demo.client.js?v=52d827a7#GalleryTooltipDemo$button_data_state_derive"
          on:blur="/c/examples/gallery/src/generated/interactive/tooltip-demo.client.js?v=52d827a7#GalleryTooltipDemo$button_blur"
          on:focus="/c/examples/gallery/src/generated/interactive/tooltip-demo.client.js?v=52d827a7#GalleryTooltipDemo$button_focus"
          on:keydown="/c/examples/gallery/src/generated/interactive/tooltip-demo.client.js?v=52d827a7#GalleryTooltipDemo$button_keydown"
          on:pointerenter="/c/examples/gallery/src/generated/interactive/tooltip-demo.client.js?v=52d827a7#GalleryTooltipDemo$button_pointerenter"
          on:pointerleave="/c/examples/gallery/src/generated/interactive/tooltip-demo.client.js?v=52d827a7#GalleryTooltipDemo$button_pointerleave"
        >
          Shipping code
        </button>
        <span
          {...tooltipContentAttributes({ contentId, open: state.open })}
          class={CONTENT_CLASS}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/tooltip-demo.client.js?v=52d827a7#GalleryTooltipDemo$span_data_state_derive"
          hidden={!state.open}
          data-bind:hidden="/c/examples/gallery/src/generated/interactive/tooltip-demo.client.js?v=52d827a7#GalleryTooltipDemo$span_hidden_derive"
        >
          Use the code printed on the packing slip.
        </span>
        <output
          data-demo-state="tooltip-open"
          data-bind="/c/examples/gallery/src/generated/interactive/tooltip-demo.client.js?v=52d827a7#GalleryTooltipDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </section>
    );
  },
});
