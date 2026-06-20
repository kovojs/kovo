/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  dialogCancel as _dialogCancel,
  dialogCloseClick as _dialogCloseClick,
  dialogTriggerClick as _dialogTriggerClick,
} from '@kovojs/headless-ui/dialog';
import {
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHandle,
  DrawerHeader,
  DrawerRoot,
  DrawerTitle,
  DrawerTrigger,
} from '@kovojs/ui/drawer';

export interface GalleryDrawerDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryDrawerDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryDrawerDemoState) => {
    const contentId = 'gallery-interactive-drawer-content';
    const titleId = 'gallery-interactive-drawer-title';
    const descriptionId = 'gallery-interactive-drawer-description';

    return (
      <DrawerRoot
        data-gallery-interactive="drawer"
        data-side="bottom"
        data-state={state.open ? 'open' : 'closed'}
        open={state.open}
      >
        <DrawerTrigger
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
          Open drawer
        </DrawerTrigger>
        <DrawerContent
          contentId={contentId}
          data-side="bottom"
          data-state={state.open ? 'open' : 'closed'}
          descriptionId={descriptionId}
          open={state.open}
          onCancel={() => {
            const result = _dialogCancel(Object(event), { open: state.open });
            if (!result?.changed) return;
            state.open = result.open;
          }}
          side="bottom"
          titleId={titleId}
        >
          <DrawerHandle />
          <DrawerHeader>
            <DrawerTitle id={titleId}>Mobile actions</DrawerTitle>
            <DrawerDescription id={descriptionId}>
              Directional sheet drawer; Vaul drag, snap, and background-scale gestures are not
              modeled.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerClose
            contentId={contentId}
            data-state={state.open ? 'open' : 'closed'}
            open={state.open}
            onClick={() => {
              const result = _dialogCloseClick(Object(event), { open: state.open });
              if (!result?.changed) return;
              state.open = result.open;
            }}
          >
            Close drawer
          </DrawerClose>
        </DrawerContent>
        <output
          style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"
          data-demo-state="drawer-open"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </DrawerRoot>
    );
  },
});
