// @kovojs-ir - lowered from examples/gallery/src/interactive/alert-dialog-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryAlertDialogDemo$AlertDialog_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryAlertDialogDemo$AlertDialog_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryAlertDialogDemo$AlertDialogTrigger_aria_expanded_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'true' : 'false'),
);
export const GalleryAlertDialogDemo$AlertDialogTrigger_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryAlertDialogDemo$AlertDialogTrigger_open_derive = derive(
  ['state'],
  (state: any) => (state.open ? '' : null),
);
export const GalleryAlertDialogDemo$AlertDialogContent_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryAlertDialogDemo$AlertDialogContent_open_derive = derive(
  ['state'],
  (state: any) => (state.open ? '' : null),
);
export const GalleryAlertDialogDemo$AlertDialogCancel_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryAlertDialogDemo$AlertDialogCancel_open_derive = derive(
  ['state'],
  (state: any) => (state.open ? '' : null),
);
export const GalleryAlertDialogDemo$AlertDialogAction_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryAlertDialogDemo$AlertDialogAction_open_derive = derive(
  ['state'],
  (state: any) => (state.open ? '' : null),
);
export const GalleryAlertDialogDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTrigger,
} from '@kovojs/ui/alert-dialog';

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
      <AlertDialog
        class="grid gap-2"
        data-gallery-interactive="alert-dialog"
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/28ad4c12/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$AlertDialog_data_state_derive"
        open={state.open}
        data-bind:open="/c/__v/28ad4c12/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$AlertDialog_open_derive"
        kovo-state='{"open":false}'
      >
        <AlertDialogTrigger
          contentId={contentId}
          on:click="/c/__v/28ad4c12/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$AlertDialogTrigger_click"
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/__v/28ad4c12/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$AlertDialogTrigger_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/28ad4c12/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$AlertDialogTrigger_data_state_derive"
          open={state.open}
          data-bind:open="/c/__v/28ad4c12/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$AlertDialogTrigger_open_derive"
        >
          Delete workspace
        </AlertDialogTrigger>
        <AlertDialogContent
          contentId={contentId}
          descriptionId={descriptionId}
          on:cancel="/c/__v/28ad4c12/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$AlertDialogContent_cancel"
          titleId={titleId}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/28ad4c12/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$AlertDialogContent_data_state_derive"
          open={state.open}
          data-bind:open="/c/__v/28ad4c12/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$AlertDialogContent_open_derive"
        >
          <h2 class={TITLE_CLASS} id={titleId}>
            Delete workspace?
          </h2>
          <p class={DESCRIPTION_CLASS} id={descriptionId}>
            This removes the shared gallery workspace for every member.
          </p>
          <AlertDialogCancel
            autoFocus={true}
            contentId={contentId}
            on:click="/c/__v/28ad4c12/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$AlertDialogCancel_click"
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/__v/28ad4c12/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$AlertDialogCancel_data_state_derive"
            open={state.open}
            data-bind:open="/c/__v/28ad4c12/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$AlertDialogCancel_open_derive"
          >
            Keep workspace
          </AlertDialogCancel>
          <AlertDialogAction
            contentId={contentId}
            intent="destructive"
            on:click="/c/__v/28ad4c12/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$AlertDialogAction_click"
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/__v/28ad4c12/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$AlertDialogAction_data_state_derive"
            open={state.open}
            data-bind:open="/c/__v/28ad4c12/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$AlertDialogAction_open_derive"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogContent>
        <output
          data-demo-state="alert-dialog-open"
          data-bind="/c/__v/28ad4c12/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js#GalleryAlertDialogDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </AlertDialog>
    );
  },
});
GalleryAlertDialogDemo.name = 'generated/interactive/alert-dialog-demo/gallery-alert-dialog-demo';
