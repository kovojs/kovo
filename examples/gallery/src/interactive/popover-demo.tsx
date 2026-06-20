/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { popoverBeforeToggle as _popoverBeforeToggle } from '@kovojs/headless-ui/popover';
import { Popover, PopoverContent, PopoverTrigger } from '@kovojs/ui/popover';

export interface GalleryPopoverDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryPopoverDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryPopoverDemoState) => {
    const contentId = 'gallery-popover-content';

    return (
      <Popover data-gallery-interactive="popover" open={state.open}>
        <PopoverTrigger contentId={contentId} open={state.open}>
          Delivery window
        </PopoverTrigger>
        <PopoverContent
          contentId={contentId}
          onBeforeToggle={() => {
            const result = _popoverBeforeToggle(Object(event), { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          open={state.open}
        >
          Weekday arrivals are available from 9 AM to 5 PM.
        </PopoverContent>
        <output
          style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"
          data-demo-state="popover-open"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </Popover>
    );
  },
});
