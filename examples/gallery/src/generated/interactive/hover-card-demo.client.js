// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  hoverCardContentPointerEnter as _hoverCardContentPointerEnter,
  hoverCardContentPointerLeave as _hoverCardContentPointerLeave,
  hoverCardEscapeKeyDown as _hoverCardEscapeKeyDown,
  hoverCardTriggerBlur as _hoverCardTriggerBlur,
  hoverCardTriggerFocus as _hoverCardTriggerFocus,
  hoverCardTriggerPointerEnter as _hoverCardTriggerPointerEnter,
  hoverCardTriggerPointerLeave as _hoverCardTriggerPointerLeave,
} from '@kovojs/ui/hover-card';

export const GalleryHoverCardDemo$HoverCardTrigger_blur = handler((event, ctx) => {
  const result = _hoverCardTriggerBlur(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});
export const GalleryHoverCardDemo$HoverCardTrigger_focus = handler((event, ctx) => {
  const result = _hoverCardTriggerFocus(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});
export const GalleryHoverCardDemo$HoverCardTrigger_keydown = handler((event, ctx) => {
  const result = _hoverCardEscapeKeyDown(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});
export const GalleryHoverCardDemo$HoverCardTrigger_pointerenter = handler((event, ctx) => {
  const result = _hoverCardTriggerPointerEnter(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});
export const GalleryHoverCardDemo$HoverCardTrigger_pointerleave = handler((event, ctx) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      const result = _hoverCardTriggerPointerLeave(Object(event), { open: ctx.state.open });
      if (result) ctx.state.open = result.open;
      resolve(undefined);
    }, 150);
  });
});
export const GalleryHoverCardDemo$HoverCardContent_pointerenter = handler((event, ctx) => {
  const result = _hoverCardContentPointerEnter(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});
export const GalleryHoverCardDemo$HoverCardContent_pointerleave = handler((event, ctx) => {
  const result = _hoverCardContentPointerLeave(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});

export const GalleryHoverCardDemo$HoverCard_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryHoverCardDemo$HoverCard_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryHoverCardDemo$HoverCardTrigger_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryHoverCardDemo$HoverCardTrigger_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryHoverCardDemo$HoverCardContent_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryHoverCardDemo$HoverCardContent_hidden_derive = derive(['state'], (state) =>
  !state.open ? '' : null,
);
export const GalleryHoverCardDemo$HoverCardContent_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryHoverCardDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
