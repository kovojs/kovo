// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import { checkboxTriggerClick as _checkboxTriggerClick } from '@kovojs/headless-ui/checkbox';

export const GalleryCheckboxDemo$input_click = handler((event, ctx) => {
  const result = _checkboxTriggerClick(Object(event), { checked: ctx.state.checked });
  if (!result) return;
  ctx.state.checked = result.checked;
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
export const GalleryCheckboxDemo$input_indeterminate_derive = derive(
  ['state'],
  (state) => state.checked === 'indeterminate',
);
export const GalleryCheckboxDemo$output_text_derive = derive(['state'], (state) =>
  String(state.checked),
);
