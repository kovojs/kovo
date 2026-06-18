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
} from '@kovojs/headless-ui/alert-dialog';
import {
  alertDialogTriggerClasses,
  alertDialogContentClasses,
  alertDialogCancelClasses,
  alertDialogActionClasses,
} from '@kovojs/ui/alert-dialog';

const TRIGGER_CLASS = alertDialogTriggerClasses.join(' ');
const CONTENT_CLASS = alertDialogContentClasses.join(' ');
const CANCEL_CLASS = alertDialogCancelClasses.join(' ');
const ACTION_CLASS = alertDialogActionClasses.join(' ');
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
        data-bind:data-state="/c/__v/b7a4f7d8/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$section_data_state_derive"
        kovo-c="gallery-alert-dialog-demo"
        kovo-state='{"open":false}'
      >
        <button
          class={TRIGGER_CLASS}
          on:click="/c/__v/b7a4f7d8/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$button_click"
          {...alertDialogTriggerAttributes({ contentId, open: state.open })}
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/__v/b7a4f7d8/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$button_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/b7a4f7d8/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$button_data_state_derive"
        >
          Delete workspace
        </button>
        <dialog
          class={CONTENT_CLASS}
          on:cancel="/c/__v/b7a4f7d8/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$dialog_cancel"
          {...alertDialogContentAttributes({
            contentId,
            descriptionId,
            open: state.open,
            titleId,
          })}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/b7a4f7d8/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$dialog_data_state_derive"
          open={state.open}
          data-bind:open="/c/__v/b7a4f7d8/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$dialog_open_derive"
        >
          <h2 class={TITLE_CLASS} id={titleId}>
            Delete workspace?
          </h2>
          <p class={DESCRIPTION_CLASS} id={descriptionId}>
            This removes the shared gallery workspace for every member.
          </p>
          <button
            class={CANCEL_CLASS}
            on:click="/c/__v/b7a4f7d8/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$button_click_2"
            {...alertDialogCancelAttributes({ autoFocus: true, contentId, open: state.open })}
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/__v/b7a4f7d8/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$button_data_state_derive_2"
          >
            Keep workspace
          </button>
          <button
            class={ACTION_CLASS}
            on:click="/c/__v/b7a4f7d8/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$button_click_3"
            {...alertDialogActionAttributes({
              contentId,
              intent: 'destructive',
              open: state.open,
            })}
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/__v/b7a4f7d8/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$button_data_state_derive_3"
          >
            Delete
          </button>
        </dialog>
        <output
          data-demo-state="alert-dialog-open"
          data-bind="/c/__v/b7a4f7d8/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </section>
    );
  },
});
GalleryAlertDialogDemo.name = 'generated/interactive/alert-dialog-demo/gallery-alert-dialog-demo';
