/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTrigger,
  alertDialogActionClick as _alertDialogActionClick,
  alertDialogCancel as _alertDialogCancel,
  alertDialogCancelClick as _alertDialogCancelClick,
  alertDialogTriggerClick as _alertDialogTriggerClick,
} from '@kovojs/ui/alert-dialog';


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
        style="display:grid;gap:0.5rem"
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
          <h2 style="font-size:1rem;font-weight:600" id={titleId}>
            Delete workspace?
          </h2>
          <p style="font-size:0.875rem;color:#525252" id={descriptionId}>
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
        <output
          style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
          data-demo-state="alert-dialog-open"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </AlertDialog>
    );
  },
});
