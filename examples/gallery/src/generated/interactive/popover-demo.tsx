// @kovojs-ir - lowered from examples/gallery/src/interactive/popover-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

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
  popoverContentAttributes,
  popoverRootAttributes,
  popoverTriggerAttributes,
} from '@kovojs/headless-ui/popover';
import { popoverClasses, popoverTriggerClasses, popoverContentClasses } from '@kovojs/ui/popover';

const ROOT_CLASS = popoverClasses.join(' ');
const TRIGGER_CLASS = popoverTriggerClasses.join(' ');
const CONTENT_CLASS = popoverContentClasses.join(' ');

export interface GalleryPopoverDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryPopoverDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryPopoverDemoState) => {
    const contentId = 'gallery-popover-content';

    return (
      <section
        class={ROOT_CLASS}
        data-gallery-interactive="popover"
        {...popoverRootAttributes({ open: state.open })}
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/0cd5c4f1/examples/gallery/src/generated/interactive/popover-demo.client.js#GalleryPopoverDemo$section_data_state_derive"
        kovo-c="gallery-popover-demo"
        kovo-state='{"open":false}'
      >
        <button
          class={TRIGGER_CLASS}
          {...popoverTriggerAttributes({ contentId, open: state.open })}
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/__v/0cd5c4f1/examples/gallery/src/generated/interactive/popover-demo.client.js#GalleryPopoverDemo$button_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/0cd5c4f1/examples/gallery/src/generated/interactive/popover-demo.client.js#GalleryPopoverDemo$button_data_state_derive"
        >
          Delivery window
        </button>
        <div
          class={CONTENT_CLASS}
          on:beforetoggle="/c/__v/0cd5c4f1/examples/gallery/src/generated/interactive/popover-demo.client.js#GalleryPopoverDemo$div_beforetoggle"
          {...popoverContentAttributes({ contentId, open: state.open })}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/0cd5c4f1/examples/gallery/src/generated/interactive/popover-demo.client.js#GalleryPopoverDemo$div_data_state_derive"
        >
          Weekday arrivals are available from 9 AM to 5 PM.
        </div>
        <output
          data-demo-state="popover-open"
          data-bind="/c/__v/0cd5c4f1/examples/gallery/src/generated/interactive/popover-demo.client.js#GalleryPopoverDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </section>
    );
  },
});
GalleryPopoverDemo.name = 'generated/interactive/popover-demo/gallery-popover-demo';
