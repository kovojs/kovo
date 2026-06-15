// @jiso-ir
import { derive, handler } from '@jiso/runtime';

export const GalleryDisclosureDemo$button_click = handler((_event, ctx) => {
  ctx.state.open = !ctx.state.open;
});

export const GalleryDisclosureDemo$button_aria_expanded_derive = derive(['state'], (state) =>
  String(state.open),
);
export const GalleryDisclosureDemo$button_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDisclosureDemo$div_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDisclosureDemo$div_hidden_derive = derive(['state'], (state) =>
  !state.open ? '' : null,
);
