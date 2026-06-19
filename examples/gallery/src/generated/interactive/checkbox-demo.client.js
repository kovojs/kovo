// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import { checkboxTriggerClick as _checkboxTriggerClick } from '@kovojs/headless-ui/checkbox';

export const GalleryCheckboxDemo$Checkbox_click = handler((event, ctx) => {
  const result = _checkboxTriggerClick(Object(event), { checked: ctx.state.checked });
  if (!result) return;
  ctx.state.checked = result.checked;
});

export const GalleryCheckboxDemo$Checkbox_checked_derive = derive(['state'], (state) =>
  state.checked ? '' : null,
);
export const GalleryCheckboxDemo$Checkbox_aria_checked_derive = derive(['state'], (state) =>
  state.checked === 'indeterminate' ? 'mixed' : state.checked === true ? 'true' : 'false',
);
export const GalleryCheckboxDemo$Checkbox_data_state_derive = derive(['state'], (state) =>
  state.checked === 'indeterminate'
    ? 'indeterminate'
    : state.checked === true
      ? 'checked'
      : 'unchecked',
);
export const GalleryCheckboxDemo$output_text_derive = derive(['state'], (state) =>
  String(state.checked),
);
