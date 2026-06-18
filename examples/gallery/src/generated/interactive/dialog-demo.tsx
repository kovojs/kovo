// @kovojs-ir - lowered from examples/gallery/src/interactive/dialog-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryDialogDemo$section_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDialogDemo$button_aria_expanded_derive = derive(['state'], (state: any) =>
  state.open ? 'true' : 'false',
);
export const GalleryDialogDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDialogDemo$dialog_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDialogDemo$dialog_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryDialogDemo$button_data_state_derive_2 = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDialogDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import {
  dialogCloseAttributes,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerAttributes,
} from '@kovojs/headless-ui/dialog';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/dialog.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const TRIGGER_CLASS =
  'inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50';
const CONTENT_CLASS =
  'm-auto max-w-lg rounded-lg border border-neutral-200 bg-white p-6 text-neutral-950 shadow-xl backdrop:bg-black/30 data-[state=closed]:hidden';
const CLOSE_CLASS =
  'inline-flex h-8 items-center justify-center rounded-md border border-neutral-300 bg-white px-2.5 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50';
const TITLE_CLASS = 'text-base font-semibold';
const DESCRIPTION_CLASS = 'text-sm text-neutral-600';

export interface GalleryDialogDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryDialogDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryDialogDemoState) => {
    const contentId = 'gallery-dialog-content';
    const titleId = 'gallery-dialog-title';
    const descriptionId = 'gallery-dialog-description';

    return (
      <section
        class="grid gap-2"
        data-gallery-interactive="dialog"
        {...dialogRootAttributes({ open: state.open })}
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/88d53d45/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$section_data_state_derive"
        kovo-c="gallery-dialog-demo"
        kovo-state='{"open":false}'
      >
        <button
          class={TRIGGER_CLASS}
          on:click="/c/__v/88d53d45/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$button_click"
          {...dialogTriggerAttributes({ contentId, open: state.open })}
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/__v/88d53d45/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$button_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/88d53d45/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$button_data_state_derive"
        >
          Review cart
        </button>
        <dialog
          class={CONTENT_CLASS}
          on:cancel="/c/__v/88d53d45/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$dialog_cancel"
          {...dialogContentAttributes({ contentId, descriptionId, open: state.open, titleId })}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/88d53d45/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$dialog_data_state_derive"
          open={state.open}
          data-bind:open="/c/__v/88d53d45/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$dialog_open_derive"
        >
          <h2 class={TITLE_CLASS} id={titleId}>
            Cart review
          </h2>
          <p class={DESCRIPTION_CLASS} id={descriptionId}>
            Confirm the current cart before checkout.
          </p>
          <button
            class={CLOSE_CLASS}
            on:click="/c/__v/88d53d45/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$button_click_2"
            {...dialogCloseAttributes({ contentId, open: state.open })}
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/__v/88d53d45/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$button_data_state_derive_2"
          >
            Close review
          </button>
        </dialog>
        <output
          data-demo-state="open"
          data-bind="/c/__v/88d53d45/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </section>
    );
  },
});
GalleryDialogDemo.name = 'generated/interactive/dialog-demo/gallery-dialog-demo';
