// @kovojs-ir - lowered from examples/gallery/src/interactive/collapsible-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryCollapsibleDemo$details_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCollapsibleDemo$details_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryCollapsibleDemo$summary_aria_expanded_derive = derive(['state'], (state: any) =>
  String(state.open),
);
export const GalleryCollapsibleDemo$summary_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCollapsibleDemo$div_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import {
  collapsibleContentAttributes,
  collapsibleRootAttributes,
  collapsibleTriggerAttributes,
} from '@kovojs/headless-ui/collapsible';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/collapsible.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const ROOT_CLASS =
  'rounded-md border border-neutral-200 bg-white text-sm text-neutral-950 data-[disabled]:opacity-50';
const TRIGGER_CLASS =
  'cursor-pointer px-3 py-2 font-medium text-neutral-950 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 data-[state=open]:bg-neutral-50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50';
const CONTENT_CLASS = 'px-3 pb-3 text-sm text-neutral-700 data-[state=closed]:hidden';

export interface GalleryCollapsibleDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryCollapsibleDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryCollapsibleDemoState) => {
    const contentId = 'gallery-collapsible-content';

    return (
      <details
        class={ROOT_CLASS}
        data-gallery-interactive="collapsible"
        {...collapsibleRootAttributes({ open: state.open })}
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/7cca2e26/examples/gallery/src/generated/interactive/collapsible-demo.client.js#GalleryCollapsibleDemo$details_data_state_derive"
        open={state.open}
        data-bind:open="/c/__v/7cca2e26/examples/gallery/src/generated/interactive/collapsible-demo.client.js#GalleryCollapsibleDemo$details_open_derive"
        kovo-c="gallery-collapsible-demo"
        kovo-state='{"open":false}'
      >
        <summary
          class={TRIGGER_CLASS}
          on:click="/c/__v/7cca2e26/examples/gallery/src/generated/interactive/collapsible-demo.client.js#GalleryCollapsibleDemo$summary_click"
          {...collapsibleTriggerAttributes({ contentId, open: state.open })}
          aria-expanded={String(state.open)}
          data-bind:aria-expanded="/c/__v/7cca2e26/examples/gallery/src/generated/interactive/collapsible-demo.client.js#GalleryCollapsibleDemo$summary_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/7cca2e26/examples/gallery/src/generated/interactive/collapsible-demo.client.js#GalleryCollapsibleDemo$summary_data_state_derive"
        >
          Release notes
        </summary>
        <div
          class={CONTENT_CLASS}
          {...collapsibleContentAttributes({ contentId, open: state.open })}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/7cca2e26/examples/gallery/src/generated/interactive/collapsible-demo.client.js#GalleryCollapsibleDemo$div_data_state_derive"
        >
          Added browser-backed compiled coverage.
        </div>
      </details>
    );
  },
});
GalleryCollapsibleDemo.name = 'generated/interactive/collapsible-demo/gallery-collapsible-demo';
