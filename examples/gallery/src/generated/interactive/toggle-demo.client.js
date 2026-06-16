// @kovojs-ir
import { derive, handler } from '@kovojs/runtime';

import { toggleTriggerClick as _toggleTriggerClick } from '@kovojs/headless-ui/primitives';

export const GalleryToggleDemo$button_click = handler((event, ctx) => {
  const result = _toggleTriggerClick(Object(event), { pressed: ctx.state.pressed });
  if (!result) return;
  ctx.state.pressed = result.pressed;
});

export const GalleryToggleDemo$button_aria_pressed_derive = derive(['state'], (state) =>
  String(state.pressed),
);
export const GalleryToggleDemo$button_data_state_derive = derive(['state'], (state) =>
  state.pressed ? 'pressed' : 'off',
);
export const GalleryToggleDemo$output_text_derive = derive(['state'], (state) =>
  state.pressed ? 'pressed' : 'off',
);
