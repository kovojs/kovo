/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  hoverCardContentPointerEnter as _hoverCardContentPointerEnter,
  hoverCardContentPointerLeave as _hoverCardContentPointerLeave,
  hoverCardEscapeKeyDown as _hoverCardEscapeKeyDown,
  hoverCardTriggerBlur as _hoverCardTriggerBlur,
  hoverCardTriggerFocus as _hoverCardTriggerFocus,
  hoverCardTriggerPointerEnter as _hoverCardTriggerPointerEnter,
  hoverCardTriggerPointerLeave as _hoverCardTriggerPointerLeave,
} from '../primitive-actions.js';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@kovojs/ui/hover-card';

export interface GalleryHoverCardDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryHoverCardDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryHoverCardDemoState) => {
    const contentId = 'gallery-hover-card-content';

    return (
      <HoverCard
        data-gallery-interactive="hover-card"
        data-state={state.open ? 'open' : 'closed'}
        open={state.open}
      >
        <HoverCardTrigger
          contentId={contentId}
          data-state={state.open ? 'open' : 'closed'}
          href="#hover-card-demo"
          open={state.open}
          onBlur={() => {
            const result = _hoverCardTriggerBlur(event! as never, { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          onFocus={() => {
            const result = _hoverCardTriggerFocus(event! as never, { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          onKeyDown={() => {
            const result = _hoverCardEscapeKeyDown(event! as never, { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          onPointerEnter={() => {
            const result = _hoverCardTriggerPointerEnter(event! as never, { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          onPointerLeave={() => {
            const result = _hoverCardTriggerPointerLeave(event! as never, { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
        >
          Ada Lovelace
        </HoverCardTrigger>
        <HoverCardContent
          contentId={contentId}
          data-state={state.open ? 'open' : 'closed'}
          hidden={!state.open}
          open={state.open}
          onPointerEnter={() => {
            const result = _hoverCardContentPointerEnter(event! as never, { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          onPointerLeave={() => {
            const result = _hoverCardContentPointerLeave(event! as never, { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
        >
          First programmer and analytical engine collaborator.
        </HoverCardContent>
        <output
          style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"
          data-demo-state="hover-card-open"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </HoverCard>
    );
  },
});
