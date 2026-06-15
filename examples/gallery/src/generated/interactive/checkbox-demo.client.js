// @jiso-ir
import { derive, handler } from '@jiso/runtime';

export const GalleryCheckboxDemo$input_click = handler((_event, ctx) => {
  ctx.state.checked = ctx.state.checked === 'indeterminate' ? true : !ctx.state.checked;
});

export const GalleryCheckboxDemo$input_aria_checked_derive = derive(['state'], (state) =>
  state.checked === 'indeterminate' ? 'mixed' : String(state.checked),
);
export const GalleryCheckboxDemo$input_checked_derive = derive(['state'], (state) =>
  state.checked === true ? '' : null,
);
export const GalleryCheckboxDemo$input_data_state_derive = derive(['state'], (state) =>
  state.checked === 'indeterminate' ? 'indeterminate' : state.checked ? 'checked' : 'unchecked',
);
export const GalleryCheckboxDemo$output_text_derive = derive(['state'], (state) =>
  String(state.checked),
);
