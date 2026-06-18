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
