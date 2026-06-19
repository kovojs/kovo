// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  tooltipEscapeKeyDown as _tooltipEscapeKeyDown,
  tooltipTriggerBlur as _tooltipTriggerBlur,
  tooltipTriggerFocus as _tooltipTriggerFocus,
  tooltipTriggerPointerEnter as _tooltipTriggerPointerEnter,
  tooltipTriggerPointerLeave as _tooltipTriggerPointerLeave,
} from '@kovojs/ui/tooltip';

export const GalleryTooltipDemo$TooltipTrigger_blur = handler((event, ctx) => {
  const result = _tooltipTriggerBlur(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});
export const GalleryTooltipDemo$TooltipTrigger_focus = handler((event, ctx) => {
  const result = _tooltipTriggerFocus(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});
export const GalleryTooltipDemo$TooltipTrigger_keydown = handler((event, ctx) => {
  const result = _tooltipEscapeKeyDown(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});
export const GalleryTooltipDemo$TooltipTrigger_pointerenter = handler((event, ctx) => {
  const result = _tooltipTriggerPointerEnter(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});
export const GalleryTooltipDemo$TooltipTrigger_pointerleave = handler((event, ctx) => {
  const result = _tooltipTriggerPointerLeave(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});

export const GalleryTooltipDemo$Tooltip_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryTooltipDemo$TooltipTrigger_aria_describedby_derive = derive(
  ['state'],
  (state) => (state.open ? 'gallery-tooltip-content' : null),
);
export const GalleryTooltipDemo$TooltipTrigger_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryTooltipDemo$TooltipContent_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryTooltipDemo$Tooltip_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryTooltipDemo$TooltipTrigger_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryTooltipDemo$TooltipContent_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryTooltipDemo$TooltipContent_hidden_derive = derive(['state'], (state) =>
  state.open ? null : '',
);
export const GalleryTooltipDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
