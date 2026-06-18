// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import { toggleTriggerClick as _toggleTriggerClick } from '@kovojs/ui/toggle';

export const GalleryToggleDemo$Toggle_click = handler((event, ctx) => {
  const result = _toggleTriggerClick(Object(event), { pressed: ctx.state.pressed });
  if (!result) return;
  ctx.state.pressed = result.pressed;
});

export const GalleryToggleDemo$Toggle_pressed_derive = derive(['state'], (state) => state.pressed);
export const GalleryToggleDemo$output_text_derive = derive(['state'], (state) =>
  state.pressed ? 'pressed' : 'off',
);
