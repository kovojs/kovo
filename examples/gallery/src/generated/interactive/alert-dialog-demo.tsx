// @kovojs-ir - lowered from examples/gallery/src/interactive/alert-dialog-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryAlertDialogDemo$section_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryAlertDialogDemo$button_aria_expanded_derive = derive(['state'], (state: any) =>
  state.open ? 'true' : 'false',
);
export const GalleryAlertDialogDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryAlertDialogDemo$dialog_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryAlertDialogDemo$dialog_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryAlertDialogDemo$button_data_state_derive_2 = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryAlertDialogDemo$button_data_state_derive_3 = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryAlertDialogDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import {
  alertDialogActionAttributes,
  alertDialogCancelAttributes,
  alertDialogContentAttributes,
  alertDialogRootAttributes,
  alertDialogTriggerAttributes,
} from '@kovojs/headless-ui/primitives';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/alert-dialog.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const TRIGGER_CLASS =
  'inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50';
const CONTENT_CLASS =
  'm-auto max-w-md rounded-lg border border-neutral-200 bg-white p-6 text-neutral-950 shadow-xl backdrop:bg-black/40 data-[state=closed]:hidden';
const CANCEL_CLASS =
  'inline-flex h-8 items-center justify-center rounded-md border border-neutral-300 bg-white px-2.5 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50';
const ACTION_CLASS =
  'inline-flex h-8 items-center justify-center rounded-md border border-transparent bg-neutral-950 px-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50 data-[intent=destructive]:bg-red-600 data-[intent=destructive]:hover:bg-red-700';
const TITLE_CLASS = 'text-base font-semibold';
const DESCRIPTION_CLASS = 'text-sm text-neutral-600';

export interface GalleryAlertDialogDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryAlertDialogDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryAlertDialogDemoState) => {
    const contentId = 'gallery-interactive-alert-dialog-content';
    const titleId = 'gallery-interactive-alert-dialog-title';
    const descriptionId = 'gallery-interactive-alert-dialog-description';

    return (
      <section
        class="grid gap-2"
        data-gallery-interactive="alert-dialog"
        {...alertDialogRootAttributes({ open: state.open })}
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=23dbfd65#GalleryAlertDialogDemo$section_data_state_derive"
        kovo-c="gallery-alert-dialog-demo"
        kovo-state='{"open":false}'
      >
        <button
          class={TRIGGER_CLASS}
          on:click="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=23dbfd65#GalleryAlertDialogDemo$button_click"
          {...alertDialogTriggerAttributes({ contentId, open: state.open })}
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=23dbfd65#GalleryAlertDialogDemo$button_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=23dbfd65#GalleryAlertDialogDemo$button_data_state_derive"
        >
          Delete workspace
        </button>
        <dialog
          class={CONTENT_CLASS}
          on:cancel="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=23dbfd65#GalleryAlertDialogDemo$dialog_cancel"
          {...alertDialogContentAttributes({
            contentId,
            descriptionId,
            open: state.open,
            titleId,
          })}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=23dbfd65#GalleryAlertDialogDemo$dialog_data_state_derive"
          open={state.open}
          data-bind:open="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=23dbfd65#GalleryAlertDialogDemo$dialog_open_derive"
        >
          <h2 class={TITLE_CLASS} id={titleId}>
            Delete workspace?
          </h2>
          <p class={DESCRIPTION_CLASS} id={descriptionId}>
            This removes the shared gallery workspace for every member.
          </p>
          <button
            class={CANCEL_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=23dbfd65#GalleryAlertDialogDemo$button_click_2"
            {...alertDialogCancelAttributes({ autoFocus: true, contentId, open: state.open })}
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=23dbfd65#GalleryAlertDialogDemo$button_data_state_derive_2"
          >
            Keep workspace
          </button>
          <button
            class={ACTION_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=23dbfd65#GalleryAlertDialogDemo$button_click_3"
            {...alertDialogActionAttributes({
              contentId,
              intent: 'destructive',
              open: state.open,
            })}
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=23dbfd65#GalleryAlertDialogDemo$button_data_state_derive_3"
          >
            Delete
          </button>
        </dialog>
        <output
          data-demo-state="alert-dialog-open"
          data-bind="/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js?v=23dbfd65#GalleryAlertDialogDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </section>
    );
  },
});
GalleryAlertDialogDemo.name = 'generated/interactive/alert-dialog-demo/gallery-alert-dialog-demo';
