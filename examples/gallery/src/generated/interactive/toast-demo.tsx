// @jiso-ir - lowered from examples/gallery/src/interactive/toast-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  toastActionAttributes,
  toastCloseAttributes,
  toastDescriptionAttributes,
  toastRootAttributes,
  toastTitleAttributes,
  toastViewportAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/toast.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const VIEWPORT_CLASS =
  'fixed z-50 grid w-full max-w-sm gap-2 p-4 outline-none data-[placement=top-start]:left-0 data-[placement=top-start]:top-0 data-[placement=top-end]:right-0 data-[placement=top-end]:top-0 data-[placement=bottom-start]:bottom-0 data-[placement=bottom-start]:left-0 data-[placement=bottom-end]:bottom-0 data-[placement=bottom-end]:right-0 data-[placement=top-center]:left-1/2 data-[placement=top-center]:top-0 data-[placement=bottom-center]:bottom-0 data-[placement=bottom-center]:left-1/2 data-[disabled]:opacity-50';
const TOAST_CLASS =
  'grid gap-2 rounded-md border border-neutral-200 bg-white p-4 text-sm text-neutral-950 shadow-lg data-[state=closed]:hidden data-[variant=success]:border-emerald-200 data-[variant=success]:bg-emerald-50 data-[variant=warning]:border-amber-200 data-[variant=warning]:bg-amber-50 data-[variant=error]:border-red-200 data-[variant=error]:bg-red-50 data-[variant=info]:border-sky-200 data-[variant=info]:bg-sky-50 data-[disabled]:opacity-50';
const TITLE_CLASS = 'font-medium text-neutral-950';
const DESCRIPTION_CLASS = 'text-neutral-700';
const ACTION_CLASS =
  'inline-flex h-8 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50';
const CLOSE_CLASS =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50';

export interface GalleryToastDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryToastDemo = component('gallery-toast-demo', {
  state: () => ({ open: true }),
  render: (_queries: Record<string, never>, state: GalleryToastDemoState) => {
    const toastState = {
      descriptionId: 'gallery-toast-description',
      id: 'gallery-toast',
      open: state.open,
      titleId: 'gallery-toast-title',
      variant: 'success' as const,
    };

    return (
      <section
        {...toastViewportAttributes({
          id: 'gallery-toast-viewport',
          label: 'Gallery notifications',
        })}
        class={VIEWPORT_CLASS}
        data-gallery-interactive="toast"
        on:keydown="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=55f6ce89#GalleryToastDemo$section_keydown"
        fw-c="gallery-toast-demo"
        fw-state='{"open":true}'
      >
        <div {...toastRootAttributes(toastState)} class={TOAST_CLASS}>
          <strong {...toastTitleAttributes({ id: 'gallery-toast-title' })} class={TITLE_CLASS}>
            Saved
          </strong>
          <p
            {...toastDescriptionAttributes({ id: 'gallery-toast-description' })}
            class={DESCRIPTION_CLASS}
          >
            Gallery settings were updated.
          </p>
          <button
            {...toastActionAttributes({ ...toastState, actionValue: 'undo' })}
            class={ACTION_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=55f6ce89#GalleryToastDemo$button_click"
          >
            Undo
          </button>
          <button
            {...toastActionAttributes({
              ...toastState,
              actionValue: 'keep-open',
              dismissOnAction: false,
            })}
            class={ACTION_CLASS}
            data-toast-cancel-dismiss=""
            on:click="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=55f6ce89#GalleryToastDemo$button_click_2"
          >
            Keep open
          </button>
          <button
            {...toastCloseAttributes(toastState)}
            class={CLOSE_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=55f6ce89#GalleryToastDemo$button_click_3"
          >
            Dismiss
          </button>
          <button
            {...toastActionAttributes({
              ...toastState,
              actionValue: 'blocked',
              disabled: true,
              dismissOnAction: false,
            })}
            class={ACTION_CLASS}
            data-toast-disabled-action=""
            on:click="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=55f6ce89#GalleryToastDemo$button_click_4"
          >
            Blocked
          </button>
        </div>
        <output data-demo-state="toast-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
