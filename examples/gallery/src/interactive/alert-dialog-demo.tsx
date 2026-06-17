/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  alertDialogActionAttributes,
  alertDialogActionClick as _alertDialogActionClick,
  alertDialogCancelAttributes,
  alertDialogCancel as _alertDialogCancel,
  alertDialogCancelClick as _alertDialogCancelClick,
  alertDialogContentAttributes,
  alertDialogRootAttributes,
  alertDialogTriggerClick as _alertDialogTriggerClick,
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
        {...alertDialogRootAttributes({ open: state.open })}
        class="grid gap-2"
        data-gallery-interactive="alert-dialog"
        data-state={state.open ? 'open' : 'closed'}
      >
        <button
          {...alertDialogTriggerAttributes({ contentId, open: state.open })}
          class={TRIGGER_CLASS}
          aria-expanded={state.open ? 'true' : 'false'}
          data-state={state.open ? 'open' : 'closed'}
          onClick={() => {
            const result = _alertDialogTriggerClick(Object(event), { open: state.open });
            if (!result?.changed) return;
            state.open = result.open;
          }}
        >
          Delete workspace
        </button>
        <dialog
          {...alertDialogContentAttributes({
            contentId,
            descriptionId,
            open: state.open,
            titleId,
          })}
          class={CONTENT_CLASS}
          data-state={state.open ? 'open' : 'closed'}
          open={state.open}
          onCancel={() => {
            const result = _alertDialogCancel(Object(event), { open: state.open });
            if (!result?.changed) return;
            state.open = result.open;
          }}
        >
          <h2 class={TITLE_CLASS} id={titleId}>
            Delete workspace?
          </h2>
          <p class={DESCRIPTION_CLASS} id={descriptionId}>
            This removes the shared gallery workspace for every member.
          </p>
          <button
            {...alertDialogCancelAttributes({ autoFocus: true, contentId, open: state.open })}
            class={CANCEL_CLASS}
            data-state={state.open ? 'open' : 'closed'}
            onClick={() => {
              const result = _alertDialogCancelClick(Object(event), { open: state.open });
              if (!result?.changed) return;
              state.open = result.open;
            }}
          >
            Keep workspace
          </button>
          <button
            {...alertDialogActionAttributes({
              contentId,
              intent: 'destructive',
              open: state.open,
            })}
            class={ACTION_CLASS}
            data-state={state.open ? 'open' : 'closed'}
            onClick={() => {
              const result = _alertDialogActionClick(Object(event), { open: state.open });
              if (!result?.changed) return;
              state.open = result.open;
            }}
          >
            Delete
          </button>
        </dialog>
        <output data-demo-state="alert-dialog-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
