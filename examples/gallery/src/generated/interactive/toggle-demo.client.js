// @jiso-ir
import { derive, handler } from '@jiso/runtime';

export const GalleryToggleDemo$button_click = handler((event, ctx) => {
  ctx.state.pressed = !ctx.state.pressed;
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
