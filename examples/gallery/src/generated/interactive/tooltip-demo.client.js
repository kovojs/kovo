// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  tooltipEscapeKeyDown as _tooltipEscapeKeyDown,
  tooltipTriggerBlur as _tooltipTriggerBlur,
  tooltipTriggerFocus as _tooltipTriggerFocus,
  tooltipTriggerPointerEnter as _tooltipTriggerPointerEnter,
  tooltipTriggerPointerLeave as _tooltipTriggerPointerLeave,
} from '@kovojs/headless-ui/tooltip';

export const GalleryTooltipDemo$button_blur = handler((event, ctx) => {
  const result = _tooltipTriggerBlur(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});
export const GalleryTooltipDemo$button_focus = handler((event, ctx) => {
  const result = _tooltipTriggerFocus(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});
export const GalleryTooltipDemo$button_keydown = handler((event, ctx) => {
  const result = _tooltipEscapeKeyDown(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});
export const GalleryTooltipDemo$button_pointerenter = handler((event, ctx) => {
  const result = _tooltipTriggerPointerEnter(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});
export const GalleryTooltipDemo$button_pointerleave = handler((event, ctx) => {
  const result = _tooltipTriggerPointerLeave(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});

export const GalleryTooltipDemo$button_aria_describedby_derive = derive(['state'], (state) =>
  state.open ? 'gallery-tooltip-content' : null,
);
export const GalleryTooltipDemo$button_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryTooltipDemo$span_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryTooltipDemo$span_hidden_derive = derive(['state'], (state) =>
  !state.open ? '' : null,
);
export const GalleryTooltipDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
