// @kovojs-ir
import { derive, handler } from '@kovojs/runtime';

import {
  hoverCardContentPointerEnter as _hoverCardContentPointerEnter,
  hoverCardContentPointerLeave as _hoverCardContentPointerLeave,
  hoverCardEscapeKeyDown as _hoverCardEscapeKeyDown,
  hoverCardTriggerBlur as _hoverCardTriggerBlur,
  hoverCardTriggerFocus as _hoverCardTriggerFocus,
  hoverCardTriggerPointerEnter as _hoverCardTriggerPointerEnter,
  hoverCardTriggerPointerLeave as _hoverCardTriggerPointerLeave,
} from '@kovojs/headless-ui/primitives';

export const GalleryHoverCardDemo$a_blur = handler((event, ctx) => {
  const result = _hoverCardTriggerBlur(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});
export const GalleryHoverCardDemo$a_focus = handler((event, ctx) => {
  const result = _hoverCardTriggerFocus(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});
export const GalleryHoverCardDemo$a_keydown = handler((event, ctx) => {
  const result = _hoverCardEscapeKeyDown(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});
export const GalleryHoverCardDemo$a_pointerenter = handler((event, ctx) => {
  const result = _hoverCardTriggerPointerEnter(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});
export const GalleryHoverCardDemo$a_pointerleave = handler((event, ctx) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      const result = _hoverCardTriggerPointerLeave(Object(event), { open: ctx.state.open });
      if (result) ctx.state.open = result.open;
      resolve(undefined);
    }, 150);
  });
});
export const GalleryHoverCardDemo$aside_pointerenter = handler((event, ctx) => {
  const result = _hoverCardContentPointerEnter(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});
export const GalleryHoverCardDemo$aside_pointerleave = handler((event, ctx) => {
  const result = _hoverCardContentPointerLeave(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});

export const GalleryHoverCardDemo$section_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryHoverCardDemo$a_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryHoverCardDemo$aside_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryHoverCardDemo$aside_hidden_derive = derive(['state'], (state) =>
  !state.open ? '' : null,
);
export const GalleryHoverCardDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
