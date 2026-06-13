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
        onKeyDown={() => {
          if (!event || Reflect['get'](event, 'key') !== 'Escape') return;
          state.open = false;
          const doc = Reflect['get'](globalThis, 'document');
          const toast = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-toast') : undefined;
          const output = doc
            ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toast-open"]')
            : undefined;
          if (toast) {
            toast['hidden'] = true;
            Object(toast)['setAttribute']?.call(toast, 'data-state', 'closed');
          }
          if (output) output['textContent'] = 'closed';
        }}
      >
        <div {...toastRootAttributes(toastState)}>
          <strong {...toastTitleAttributes({ id: 'gallery-toast-title' })}>Saved</strong>
          <p {...toastDescriptionAttributes({ id: 'gallery-toast-description' })}>
            Gallery settings were updated.
          </p>
          <button
            {...toastActionAttributes({ ...toastState, actionValue: 'undo' })}
            onClick={() => {
              state.open = false;
              const doc = Reflect['get'](globalThis, 'document');
              const toast = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-toast')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toast-open"]')
                : undefined;
              if (toast) {
                toast['hidden'] = true;
                Object(toast)['setAttribute']?.call(toast, 'data-state', 'closed');
              }
              if (output) output['textContent'] = 'closed';
            }}
          >
            Undo
          </button>
          <button
            {...toastActionAttributes({
              ...toastState,
              actionValue: 'keep-open',
              dismissOnAction: false,
            })}
            data-toast-cancel-dismiss=""
            onClick={() => {
              if (!event) return;
              Object(event)['preventDefault']?.call(event);
              state.open = true;

              const doc = Reflect['get'](globalThis, 'document');
              const toast = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-toast')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toast-open"]')
                : undefined;
              if (toast) {
                toast['hidden'] = false;
                Object(toast)['setAttribute']?.call(toast, 'data-state', 'open');
              }
              if (output) output['textContent'] = 'canceled';
            }}
          >
            Keep open
          </button>
          <button
            {...toastCloseAttributes(toastState)}
            onClick={() => {
              state.open = false;
              const doc = Reflect['get'](globalThis, 'document');
              const toast = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-toast')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toast-open"]')
                : undefined;
              if (toast) {
                toast['hidden'] = true;
                Object(toast)['setAttribute']?.call(toast, 'data-state', 'closed');
              }
              if (output) output['textContent'] = 'closed';
            }}
          >
            Dismiss
          </button>
        </div>
        <output data-demo-state="toast-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
