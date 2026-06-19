/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  alertDialogActionClick as _alertDialogActionClick,
  alertDialogCancel as _alertDialogCancel,
  alertDialogCancelClick as _alertDialogCancelClick,
  alertDialogTriggerClick as _alertDialogTriggerClick,
} from '@kovojs/headless-ui/alert-dialog';
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
        open={state.open}
      >
        <AlertDialogTrigger
          aria-expanded={state.open ? 'true' : 'false'}
          contentId={contentId}
          data-state={state.open ? 'open' : 'closed'}
          open={state.open}
          onClick={() => {
            const result = _alertDialogTriggerClick(Object(event), { open: state.open });
            if (!result?.changed) return;
            state.open = result.open;
          }}
        >
          Delete workspace
        </AlertDialogTrigger>
        <AlertDialogContent
          contentId={contentId}
          data-state={state.open ? 'open' : 'closed'}
          descriptionId={descriptionId}
          open={state.open}
          onCancel={() => {
            const result = _alertDialogCancel(Object(event), { open: state.open });
            if (!result?.changed) return;
            state.open = result.open;
          }}
          titleId={titleId}
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
            data-state={state.open ? 'open' : 'closed'}
            open={state.open}
            onClick={() => {
              const result = _alertDialogCancelClick(Object(event), { open: state.open });
              if (!result?.changed) return;
              state.open = result.open;
            }}
          >
            Keep workspace
          </AlertDialogCancel>
          <AlertDialogAction
            contentId={contentId}
            data-state={state.open ? 'open' : 'closed'}
            intent="destructive"
            open={state.open}
            onClick={() => {
              const result = _alertDialogActionClick(Object(event), { open: state.open });
              if (!result?.changed) return;
              state.open = result.open;
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogContent>
        <output data-demo-state="alert-dialog-open">{state.open ? 'open' : 'closed'}</output>
      </AlertDialog>
    );
  },
});
