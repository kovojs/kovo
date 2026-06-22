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

    // Popover is not in the compiler's primitive-reactive registry, so the
    // content's visibility attr (`data-state`, computed inside PopoverContent) is
    // frozen at SSR unless hand-written here at the call site. Writing `data-state`
    // makes the compiler emit data-bind:data-state, which the component forwards
    // (passThroughProps) so `[data-state=closed]{display:none}` toggles on open.
    // (See plans/bad-components.md — a registry entry is the longer-term fix.)
    return (
      <Popover
        data-gallery-interactive="popover"
        data-state={state.open ? 'open' : 'closed'}
        open={state.open}
      >
        <PopoverTrigger
          contentId={contentId}
          data-state={state.open ? 'open' : 'closed'}
          open={state.open}
        >
          Delivery window
        </PopoverTrigger>
        <PopoverContent
          contentId={contentId}
          data-state={state.open ? 'open' : 'closed'}
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
