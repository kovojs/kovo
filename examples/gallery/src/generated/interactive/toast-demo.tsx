// @kovojs-ir - lowered from examples/gallery/src/interactive/toast-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryToastDemo$Toast_data_state_derive = derive(['state'], (state: any) =>
  state.previousOpen ? 'open' : 'closed',
);
export const GalleryToastDemo$Toast_hidden_derive = derive(['state'], (state: any) =>
  !state.previousOpen ? '' : null,
);
export const GalleryToastDemo$ToastClose_data_state_derive = derive(['state'], (state: any) =>
  state.previousOpen ? 'open' : 'closed',
);
export const GalleryToastDemo$Toast_data_state_derive_2 = derive(['state'], (state: any) =>
  state.activeOpen ? 'open' : 'closed',
);
export const GalleryToastDemo$Toast_hidden_derive_2 = derive(['state'], (state: any) =>
  !state.activeOpen ? '' : null,
);
export const GalleryToastDemo$ToastClose_data_state_derive_2 = derive(['state'], (state: any) =>
  state.activeOpen ? 'open' : 'closed',
);
export const GalleryToastDemo$output_text_derive = derive(['state'], (state: any) =>
  state.activeOpen ? 'open' : state.previousOpen ? 'stacked' : 'empty',
);

import { component } from '@kovojs/core';
import { normalizeToastDuration } from '@kovojs/headless-ui/toast';
import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastTitle,
  ToastViewport,
} from '@kovojs/ui/toast';

const TRIGGER_CLASS =
  'inline-flex h-9 w-fit items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950';

export interface GalleryToastDemoState {
  activeCount: number;
  activeOpen: boolean;
  previousCount: number;
  previousOpen: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryToastDemo = component({
  state: () => ({ activeCount: 0, activeOpen: false, previousCount: 0, previousOpen: false }),
  render: (_queries: Record<string, never>, state: GalleryToastDemoState) => {
    const durationMs = normalizeToastDuration(5000);
    const activeToastState = {
      descriptionId: 'gallery-toast-description',
      id: 'gallery-toast',
      open: state.activeOpen,
      titleId: 'gallery-toast-title',
      variant: 'success' as const,
    };
    const previousToastState = {
      descriptionId: 'gallery-toast-previous-description',
      id: 'gallery-toast-previous',
      open: state.previousOpen,
      titleId: 'gallery-toast-previous-title',
      variant: 'info' as const,
    };

    return (
      <ToastViewport
        data-gallery-interactive="toast"
        data-toast-duration-ms={durationMs}
        id="gallery-toast-viewport"
        label="Gallery notifications"
        on:keydown="/c/__v/f6dc7e0f/examples/gallery/src/generated/interactive/toast-demo.client.js#GalleryToastDemo$ToastViewport_keydown"
        kovo-state='{"activeCount":0,"activeOpen":false,"previousCount":0,"previousOpen":false}'
      >
        <style>{'@keyframes gallery-toast-auto-dismiss{from{opacity:1}to{opacity:1}}'}</style>
        <button
          class={TRIGGER_CLASS}
          data-toast-show=""
          type="button"
          on:click="/c/__v/f6dc7e0f/examples/gallery/src/generated/interactive/toast-demo.client.js#GalleryToastDemo$button_click"
        >
          Show toast
        </button>
        <Toast
          {...previousToastState}
          data-state={state.previousOpen ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/f6dc7e0f/examples/gallery/src/generated/interactive/toast-demo.client.js#GalleryToastDemo$Toast_data_state_derive"
          hidden={!state.previousOpen}
          data-bind:hidden="/c/__v/f6dc7e0f/examples/gallery/src/generated/interactive/toast-demo.client.js#GalleryToastDemo$Toast_hidden_derive"
        >
          <ToastTitle id="gallery-toast-previous-title">Previous save</ToastTitle>
          <ToastDescription id="gallery-toast-previous-description">
            Gallery settings update.
          </ToastDescription>
          <ToastClose
            on:click="/c/__v/f6dc7e0f/examples/gallery/src/generated/interactive/toast-demo.client.js#GalleryToastDemo$ToastClose_click"
            {...previousToastState}
            data-state={state.previousOpen ? 'open' : 'closed'}
            data-bind:data-state="/c/__v/f6dc7e0f/examples/gallery/src/generated/interactive/toast-demo.client.js#GalleryToastDemo$ToastClose_data_state_derive"
          >
            Dismiss
          </ToastClose>
        </Toast>
        <Toast
          on:animationend="/c/__v/f6dc7e0f/examples/gallery/src/generated/interactive/toast-demo.client.js#GalleryToastDemo$Toast_animationend"
          style={{
            animationDuration: `${durationMs}ms`,
            animationName: 'gallery-toast-auto-dismiss',
            animationTimingFunction: 'linear',
          }}
          {...activeToastState}
          data-state={state.activeOpen ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/f6dc7e0f/examples/gallery/src/generated/interactive/toast-demo.client.js#GalleryToastDemo$Toast_data_state_derive_2"
          hidden={!state.activeOpen}
          data-bind:hidden="/c/__v/f6dc7e0f/examples/gallery/src/generated/interactive/toast-demo.client.js#GalleryToastDemo$Toast_hidden_derive_2"
        >
          <ToastTitle id="gallery-toast-title">Saved</ToastTitle>
          <ToastDescription id="gallery-toast-description">
            Gallery settings update.
          </ToastDescription>
          <ToastAction
            actionValue="undo"
            on:click="/c/__v/f6dc7e0f/examples/gallery/src/generated/interactive/toast-demo.client.js#GalleryToastDemo$ToastAction_click"
            {...activeToastState}
          >
            Undo
          </ToastAction>
          <ToastAction
            actionValue="keep-open"
            data-toast-cancel-dismiss=""
            dismissOnAction={false}
            on:click="/c/__v/f6dc7e0f/examples/gallery/src/generated/interactive/toast-demo.client.js#GalleryToastDemo$ToastAction_click_2"
            {...activeToastState}
          >
            Keep open
          </ToastAction>
          <ToastClose
            on:click="/c/__v/f6dc7e0f/examples/gallery/src/generated/interactive/toast-demo.client.js#GalleryToastDemo$ToastClose_click_2"
            {...activeToastState}
            data-state={state.activeOpen ? 'open' : 'closed'}
            data-bind:data-state="/c/__v/f6dc7e0f/examples/gallery/src/generated/interactive/toast-demo.client.js#GalleryToastDemo$ToastClose_data_state_derive_2"
          >
            Dismiss
          </ToastClose>
          <ToastAction
            actionValue="blocked"
            data-toast-disabled-action=""
            disabled={true}
            dismissOnAction={false}
            on:click="/c/__v/f6dc7e0f/examples/gallery/src/generated/interactive/toast-demo.client.js#GalleryToastDemo$ToastAction_click_3"
            {...activeToastState}
          >
            Blocked
          </ToastAction>
        </Toast>
        <output
          data-demo-state="toast-open"
          data-bind="/c/__v/f6dc7e0f/examples/gallery/src/generated/interactive/toast-demo.client.js#GalleryToastDemo$output_text_derive"
        >
          {state.activeOpen ? 'open' : state.previousOpen ? 'stacked' : 'empty'}
        </output>
        <output data-demo-state="toast-count" data-bind="state.activeCount">
          {state.activeCount}
        </output>
      </ToastViewport>
    );
  },
});
GalleryToastDemo.name = 'generated/interactive/toast-demo/gallery-toast-demo';
