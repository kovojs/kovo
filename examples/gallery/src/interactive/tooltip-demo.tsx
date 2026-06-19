/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  tooltipEscapeKeyDown as _tooltipEscapeKeyDown,
  tooltipTriggerBlur as _tooltipTriggerBlur,
  tooltipTriggerFocus as _tooltipTriggerFocus,
  tooltipTriggerPointerEnter as _tooltipTriggerPointerEnter,
  tooltipTriggerPointerLeave as _tooltipTriggerPointerLeave,
} from '@kovojs/headless-ui/tooltip';
import { Tooltip, TooltipContent, TooltipTrigger } from '@kovojs/ui/tooltip';

export interface GalleryTooltipDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryTooltipDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryTooltipDemoState) => {
    const contentId = 'gallery-tooltip-content';

    return (
      <Tooltip data-gallery-interactive="tooltip" open={state.open}>
        <TooltipTrigger
          aria-describedby={state.open ? 'gallery-tooltip-content' : null}
          contentId={contentId}
          onBlur={() => {
            const result = _tooltipTriggerBlur(Object(event), { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          onFocus={() => {
            const result = _tooltipTriggerFocus(Object(event), { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          onKeyDown={() => {
            const result = _tooltipEscapeKeyDown(Object(event), { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          onPointerEnter={() => {
            const result = _tooltipTriggerPointerEnter(Object(event), { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          onPointerLeave={() => {
            const result = _tooltipTriggerPointerLeave(Object(event), { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          open={state.open}
        >
          Shipping code
        </TooltipTrigger>
        <TooltipContent contentId={contentId} open={state.open}>
          Use the code printed on the packing slip.
        </TooltipContent>
        <output data-demo-state="tooltip-open">{state.open ? 'open' : 'closed'}</output>
      </Tooltip>
    );
  },
});
