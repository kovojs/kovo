// @jiso-ir
import { derive, handler } from '@jiso/runtime';

export const GallerySwitchDemo$input_click = handler((_event, ctx) => {
  ctx.state.checked = !ctx.state.checked;
});

export const GallerySwitchDemo$input_aria_checked_derive = derive(['state'], (state) =>
  String(state.checked),
);
export const GallerySwitchDemo$input_checked_derive = derive(['state'], (state) =>
  state.checked ? '' : null,
);
export const GallerySwitchDemo$input_data_state_derive = derive(['state'], (state) =>
  state.checked ? 'checked' : 'unchecked',
);
export const GallerySwitchDemo$output_text_derive = derive(['state'], (state) =>
  state.checked ? 'on' : 'off',
);
