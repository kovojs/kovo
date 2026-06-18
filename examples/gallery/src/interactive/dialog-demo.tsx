/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  dialogCancel as _dialogCancel,
  dialogCloseClick as _dialogCloseClick,
  dialogTriggerClick as _dialogTriggerClick,
} from '@kovojs/ui/dialog';

const TITLE_CLASS = 'text-base font-semibold';
const DESCRIPTION_CLASS = 'text-sm text-neutral-600';

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
          <h2 class={TITLE_CLASS} id={titleId}>
            Cart review
          </h2>
          <p class={DESCRIPTION_CLASS} id={descriptionId}>
            Confirm the current cart before checkout.
          </p>
          <DialogClose
            contentId={contentId}
            onClick={() => {
              const result = _dialogCloseClick(Object(event), { open: state.open });
              if (!result?.changed) return;
              state.open = result.open;
            }}
            open={state.open}
          >
            Close review
          </DialogClose>
        </DialogContent>
        <output data-demo-state="open">{state.open ? 'open' : 'closed'}</output>
      </Dialog>
    );
  },
});
