// @kovojs-ir - lowered from examples/gallery/src/interactive/toast-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryToastDemo$div_data_state_derive = derive(['state'], (state: any) =>
  state.previousOpen ? 'open' : 'closed',
);
export const GalleryToastDemo$div_hidden_derive = derive(['state'], (state: any) =>
  !state.previousOpen ? '' : null,
);
export const GalleryToastDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.previousOpen ? 'open' : 'closed',
);
export const GalleryToastDemo$div_data_state_derive_2 = derive(['state'], (state: any) =>
  state.activeOpen ? 'open' : 'closed',
);
export const GalleryToastDemo$div_hidden_derive_2 = derive(['state'], (state: any) =>
  !state.activeOpen ? '' : null,
);
export const GalleryToastDemo$button_data_state_derive_2 = derive(['state'], (state: any) =>
  state.activeOpen ? 'open' : 'closed',
);
export const GalleryToastDemo$p_text_derive = derive(
  ['state'],
  (state: any) => 'Gallery settings update #' + state.previousCount,
);
export const GalleryToastDemo$p_text_derive_2 = derive(
  ['state'],
  (state: any) => 'Gallery settings update #' + state.activeCount,
);
export const GalleryToastDemo$output_text_derive = derive(['state'], (state: any) =>
  state.activeOpen ? 'open' : state.previousOpen ? 'stacked' : 'empty',
);

import { component } from '@kovojs/core';
import {
  normalizeToastDuration,
  toastActionAttributes,
  toastCloseAttributes,
  toastDescriptionAttributes,
  toastRootAttributes,
  toastTitleAttributes,
  toastViewportAttributes,
} from '@kovojs/headless-ui/toast';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/toast.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const VIEWPORT_CLASS =
  'fixed z-50 grid w-full max-w-sm gap-2 p-4 outline-none data-[placement=top-start]:left-0 data-[placement=top-start]:top-0 data-[placement=top-end]:right-0 data-[placement=top-end]:top-0 data-[placement=bottom-start]:bottom-0 data-[placement=bottom-start]:left-0 data-[placement=bottom-end]:bottom-0 data-[placement=bottom-end]:right-0 data-[placement=top-center]:left-1/2 data-[placement=top-center]:top-0 data-[placement=bottom-center]:bottom-0 data-[placement=bottom-center]:left-1/2 data-[disabled]:opacity-50';
const TOAST_CLASS =
  'grid gap-2 rounded-md border border-neutral-200 bg-white p-4 text-sm text-neutral-950 shadow-lg data-[state=closed]:hidden data-[variant=success]:border-emerald-200 data-[variant=success]:bg-emerald-50 data-[variant=info]:border-sky-200 data-[variant=info]:bg-sky-50 data-[disabled]:opacity-50';
const TIMER_CLASS =
  '[animation:gallery-toast-auto-dismiss_5000ms_linear] hover:[animation-play-state:paused] focus-within:[animation-play-state:paused] data-[state=closed]:[animation:none]';
const TRIGGER_CLASS =
  'inline-flex h-9 w-fit items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950';
const TITLE_CLASS = 'font-medium text-neutral-950';
const DESCRIPTION_CLASS = 'text-neutral-700';
const ACTION_CLASS =
  'inline-flex h-8 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50';
const CLOSE_CLASS =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50';

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
      <section
        {...toastViewportAttributes({
          id: 'gallery-toast-viewport',
          label: 'Gallery notifications',
        })}
        class={VIEWPORT_CLASS}
        data-gallery-interactive="toast"
        data-toast-duration-ms={durationMs}
        on:keydown="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=fb845d3e#GalleryToastDemo$section_keydown"
        kovo-c="gallery-toast-demo"
        kovo-state='{"activeCount":0,"activeOpen":false,"previousCount":0,"previousOpen":false}'
      >
        <style>{'@keyframes gallery-toast-auto-dismiss{from{opacity:1}to{opacity:1}}'}</style>
        <button
          class={TRIGGER_CLASS}
          data-toast-show=""
          type="button"
          on:click="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=fb845d3e#GalleryToastDemo$button_click"
        >
          Show toast
        </button>
        <div
          class={TOAST_CLASS}
          {...toastRootAttributes(previousToastState)}
          data-state={state.previousOpen ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=fb845d3e#GalleryToastDemo$div_data_state_derive"
          hidden={!state.previousOpen}
          data-bind:hidden="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=fb845d3e#GalleryToastDemo$div_hidden_derive"
        >
          <strong
            class={TITLE_CLASS}
            {...toastTitleAttributes({ id: 'gallery-toast-previous-title' })}
          >
            Previous save
          </strong>
          <p
            class={DESCRIPTION_CLASS}
            {...toastDescriptionAttributes({ id: 'gallery-toast-previous-description' })}
            data-bind="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=fb845d3e#GalleryToastDemo$p_text_derive"
          >
            {'Gallery settings update #' + state.previousCount}
          </p>
          <button
            class={CLOSE_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=fb845d3e#GalleryToastDemo$button_click_2"
            {...toastCloseAttributes(previousToastState)}
            data-state={state.previousOpen ? 'open' : 'closed'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=fb845d3e#GalleryToastDemo$button_data_state_derive"
          >
            Dismiss
          </button>
        </div>
        <div
          class={TOAST_CLASS + ' ' + TIMER_CLASS}
          on:animationend="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=fb845d3e#GalleryToastDemo$div_animationend"
          {...toastRootAttributes(activeToastState)}
          data-state={state.activeOpen ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=fb845d3e#GalleryToastDemo$div_data_state_derive_2"
          hidden={!state.activeOpen}
          data-bind:hidden="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=fb845d3e#GalleryToastDemo$div_hidden_derive_2"
        >
          <strong class={TITLE_CLASS} {...toastTitleAttributes({ id: 'gallery-toast-title' })}>
            Saved
          </strong>
          <p
            class={DESCRIPTION_CLASS}
            {...toastDescriptionAttributes({ id: 'gallery-toast-description' })}
            data-bind="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=fb845d3e#GalleryToastDemo$p_text_derive_2"
          >
            {'Gallery settings update #' + state.activeCount}
          </p>
          <button
            class={ACTION_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=fb845d3e#GalleryToastDemo$button_click_3"
            {...toastActionAttributes({ ...activeToastState, actionValue: 'undo' })}
          >
            Undo
          </button>
          <button
            class={ACTION_CLASS}
            data-toast-cancel-dismiss=""
            on:click="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=fb845d3e#GalleryToastDemo$button_click_4"
            {...toastActionAttributes({
              ...activeToastState,
              actionValue: 'keep-open',
              dismissOnAction: false,
            })}
          >
            Keep open
          </button>
          <button
            class={CLOSE_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=fb845d3e#GalleryToastDemo$button_click_5"
            {...toastCloseAttributes(activeToastState)}
            data-state={state.activeOpen ? 'open' : 'closed'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=fb845d3e#GalleryToastDemo$button_data_state_derive_2"
          >
            Dismiss
          </button>
          <button
            class={ACTION_CLASS}
            data-toast-disabled-action=""
            on:click="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=fb845d3e#GalleryToastDemo$button_click_6"
            {...toastActionAttributes({
              ...activeToastState,
              actionValue: 'blocked',
              disabled: true,
              dismissOnAction: false,
            })}
          >
            Blocked
          </button>
        </div>
        <output
          data-demo-state="toast-open"
          data-bind="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=fb845d3e#GalleryToastDemo$output_text_derive"
        >
          {state.activeOpen ? 'open' : state.previousOpen ? 'stacked' : 'empty'}
        </output>
        <output data-demo-state="toast-count" data-bind="state.activeCount">
          {state.activeCount}
        </output>
      </section>
    );
  },
});
GalleryToastDemo.name = 'generated/interactive/toast-demo/gallery-toast-demo';
