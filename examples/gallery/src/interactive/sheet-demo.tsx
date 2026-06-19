/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  dialogCancel as _dialogCancel,
  dialogCloseClick as _dialogCloseClick,
  dialogTriggerClick as _dialogTriggerClick,
} from '@kovojs/ui/dialog';
import {
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetRoot,
  SheetTitle,
  SheetTrigger,
} from '@kovojs/ui/sheet';

export interface GallerySheetDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GallerySheetDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GallerySheetDemoState) => {
    const contentId = 'gallery-interactive-sheet-content';
    const titleId = 'gallery-interactive-sheet-title';
    const descriptionId = 'gallery-interactive-sheet-description';

    return (
      <SheetRoot
        data-gallery-interactive="sheet"
        data-side="right"
        data-state={state.open ? 'open' : 'closed'}
        open={state.open}
      >
        <SheetTrigger
          aria-expanded={state.open ? 'true' : 'false'}
          contentId={contentId}
          data-state={state.open ? 'open' : 'closed'}
          open={state.open}
          onClick={() => {
            const result = _dialogTriggerClick(Object(event), { open: state.open });
            if (!result?.changed) return;
            state.open = result.open;
          }}
        >
          Open sheet
        </SheetTrigger>
        <SheetContent
          contentId={contentId}
          data-side="right"
          data-state={state.open ? 'open' : 'closed'}
          descriptionId={descriptionId}
          open={state.open}
          onCancel={() => {
            const result = _dialogCancel(Object(event), { open: state.open });
            if (!result?.changed) return;
            state.open = result.open;
          }}
          side="right"
          titleId={titleId}
        >
          <SheetHeader>
            <SheetTitle id={titleId}>Account settings</SheetTitle>
            <SheetDescription id={descriptionId}>
              Review the account panel side sheet.
            </SheetDescription>
          </SheetHeader>
          <SheetClose
            contentId={contentId}
            data-state={state.open ? 'open' : 'closed'}
            open={state.open}
            onClick={() => {
              const result = _dialogCloseClick(Object(event), { open: state.open });
              if (!result?.changed) return;
              state.open = result.open;
            }}
          >
            Close sheet
          </SheetClose>
        </SheetContent>
        <output data-demo-state="sheet-open">{state.open ? 'open' : 'closed'}</output>
      </SheetRoot>
    );
  },
});
