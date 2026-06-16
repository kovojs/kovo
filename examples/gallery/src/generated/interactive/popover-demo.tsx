// @kovojs-ir - lowered from examples/gallery/src/interactive/popover-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime';

export const GalleryPopoverDemo$section_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryPopoverDemo$button_aria_expanded_derive = derive(['state'], (state: any) =>
  state.open ? 'true' : 'false',
);
export const GalleryPopoverDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryPopoverDemo$div_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryPopoverDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import {
  popoverBeforeToggle as _popoverBeforeToggle,
  popoverContentAttributes,
  popoverRootAttributes,
  popoverTriggerAttributes,
} from '@kovojs/headless-ui/primitives';

// Tailwind classes mirror the @kovojs/ui styled layer (packages/ui/src/popover.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS = 'relative inline-block text-sm text-neutral-950 data-[disabled]:opacity-50';
const TRIGGER_CLASS =
  'inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-neutral-100';
const CONTENT_CLASS =
  'mt-2 w-64 rounded-md border border-neutral-200 bg-white p-3 text-sm text-neutral-700 shadow-md data-[state=closed]:hidden';

export interface GalleryPopoverDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryPopoverDemo = component('gallery-popover-demo', {
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryPopoverDemoState) => {
    const contentId = 'gallery-popover-content';

    return (
      <section
        {...popoverRootAttributes({ open: state.open })}
        class={ROOT_CLASS}
        data-gallery-interactive="popover"
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/examples/gallery/src/generated/interactive/popover-demo.client.js?v=284715ea#GalleryPopoverDemo$section_data_state_derive"
        kovo-c="gallery-popover-demo"
        kovo-state='{"open":false}'
      >
        <button
          {...popoverTriggerAttributes({ contentId, open: state.open })}
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/examples/gallery/src/generated/interactive/popover-demo.client.js?v=284715ea#GalleryPopoverDemo$button_aria_expanded_derive"
          class={TRIGGER_CLASS}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/popover-demo.client.js?v=284715ea#GalleryPopoverDemo$button_data_state_derive"
        >
          Delivery window
        </button>
        <div
          {...popoverContentAttributes({ contentId, open: state.open })}
          class={CONTENT_CLASS}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/popover-demo.client.js?v=284715ea#GalleryPopoverDemo$div_data_state_derive"
          on:beforetoggle="/c/examples/gallery/src/generated/interactive/popover-demo.client.js?v=284715ea#GalleryPopoverDemo$div_beforetoggle"
        >
          Weekday arrivals are available from 9 AM to 5 PM.
        </div>
        <output
          data-demo-state="popover-open"
          data-bind="/c/examples/gallery/src/generated/interactive/popover-demo.client.js?v=284715ea#GalleryPopoverDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </section>
    );
  },
});
