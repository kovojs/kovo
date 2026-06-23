/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  dialogCancel as _dialogCancel,
  dialogCloseClick as _dialogCloseClick,
  dialogTriggerClick as _dialogTriggerClick,
} from '@kovojs/headless-ui/dialog';
import {
  Dialog,
  DialogClose,
  DialogCloseX,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@kovojs/ui/dialog';

export interface GalleryDialogDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryDialogDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryDialogDemoState) => {
    const contentId = 'gallery-dialog-content';
    const titleId = 'gallery-dialog-title';
    const descriptionId = 'gallery-dialog-description';

    return (
      <Dialog data-gallery-interactive="dialog" open={state.open}>
        <DialogTrigger
          contentId={contentId}
          onClick={() => {
            const result = _dialogTriggerClick(Object(event), { open: state.open });
            if (!result?.changed) return;
            state.open = result.open;
          }}
          open={state.open}
        >
          Review cart
        </DialogTrigger>
        <DialogContent
          contentId={contentId}
          descriptionId={descriptionId}
          onCancel={() => {
            const result = _dialogCancel(Object(event), { open: state.open });
            if (!result?.changed) return;
            state.open = result.open;
          }}
          open={state.open}
          titleId={titleId}
        >
          <DialogCloseX
            contentId={contentId}
            onClick={() => {
              const result = _dialogCloseClick(Object(event), { open: state.open });
              if (!result?.changed) return;
              state.open = result.open;
              const root = Object(event)['target']?.closest?.('[data-gallery-interactive="dialog"]');
              const trigger = Object(root)?.querySelector?.('button[command="show-modal"]');
              Object(trigger)['focus']?.call(trigger);
            }}
            open={state.open}
          />
          <DialogHeader>
            <DialogTitle id={titleId}>Cart review</DialogTitle>
            <DialogDescription id={descriptionId}>
              Confirm the current cart before checkout.
            </DialogDescription>
          </DialogHeader>
          <DialogClose
            contentId={contentId}
            onClick={() => {
              const result = _dialogCloseClick(Object(event), { open: state.open });
              if (!result?.changed) return;
              state.open = result.open;
              const root = Object(event)['target']?.closest?.('[data-gallery-interactive="dialog"]');
              const trigger = Object(root)?.querySelector?.('button[command="show-modal"]');
              Object(trigger)['focus']?.call(trigger);
            }}
            open={state.open}
          >
            Close review
          </DialogClose>
        </DialogContent>
        <output
          style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"
          data-demo-state="open"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </Dialog>
    );
  },
});
