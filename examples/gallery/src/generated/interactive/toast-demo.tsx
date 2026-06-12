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
        class="grid gap-2"
        data-gallery-interactive="toast"
        on:keydown="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=085a0dda#GalleryToastDemo$section_keydown"
        fw-c="gallery-toast-demo"
        fw-state='{"open":true}'
      >
        <article {...toastRootAttributes(toastState)}>
          <strong {...toastTitleAttributes({ id: 'gallery-toast-title' })}>Saved</strong>
          <p {...toastDescriptionAttributes({ id: 'gallery-toast-description' })}>
            Gallery settings were updated.
          </p>
          <button
            {...toastActionAttributes({ ...toastState, actionValue: 'undo' })}
            on:click="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=085a0dda#GalleryToastDemo$button_click"
          >
            Undo
          </button>
          <button
            {...toastCloseAttributes(toastState)}
            on:click="/c/examples/gallery/src/generated/interactive/toast-demo.client.js?v=085a0dda#GalleryToastDemo$button_click_2"
          >
            Dismiss
          </button>
        </article>
        <output data-demo-state="toast-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
