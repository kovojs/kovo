// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import { checkboxTriggerClick as _checkboxTriggerClick } from '@kovojs/ui/checkbox';

import { checkboxGroupItemClick as _checkboxGroupItemClick } from '@kovojs/ui/checkbox-group';

export const GalleryCheckboxGroupDemo$input_click = handler((event, ctx) => {
  const result = _checkboxTriggerClick(Object(event), {
    checked:
      ctx.state.value === 'updates,billing'
        ? true
        : ctx.state.value === ''
          ? false
          : 'indeterminate',
  });
  if (!result) return;
  ctx.state.value = result.checked === true ? 'updates,billing' : '';
});
export const GalleryCheckboxGroupDemo$CheckboxGroupControl_click = handler((event, ctx) => {
  const result = _checkboxGroupItemClick(Object(event), {
    itemValue: 'updates',
    items: [{ value: 'updates' }, { value: 'billing' }],
    value:
      ctx.state.value === 'updates,billing'
        ? ['updates', 'billing']
        : ctx.state.value === ''
          ? []
          : [ctx.state.value],
  });
  if (!result) return;
  ctx.state.activeValue = 'updates';
  ctx.state.value = result.value.toString();
});
export const GalleryCheckboxGroupDemo$CheckboxGroupControl_click_2 = handler((event, ctx) => {
  const result = _checkboxGroupItemClick(Object(event), {
    itemValue: 'billing',
    items: [{ value: 'updates' }, { value: 'billing' }],
    value:
      ctx.state.value === 'updates,billing'
        ? ['updates', 'billing']
        : ctx.state.value === ''
          ? []
          : [ctx.state.value],
  });
  if (!result) return;
  ctx.state.activeValue = 'billing';
  ctx.state.value = result.value.toString();
});

export const GalleryCheckboxGroupDemo$input_aria_checked_derive = derive(['state'], (state) =>
  state.value === 'updates,billing' ? 'true' : state.value === '' ? 'false' : 'mixed',
);
export const GalleryCheckboxGroupDemo$input_checked_derive = derive(['state'], (state) =>
  state.value === 'updates,billing' ? '' : null,
);
export const GalleryCheckboxGroupDemo$input_data_state_derive = derive(['state'], (state) =>
  state.value === 'updates,billing'
    ? 'checked'
    : state.value === ''
      ? 'unchecked'
      : 'indeterminate',
);
export const GalleryCheckboxGroupDemo$input_indeterminate_derive = derive(
  ['state'],
  (state) => state.value !== '' && state.value !== 'updates,billing',
);
export const GalleryCheckboxGroupDemo$CheckboxGroupControl_aria_checked_derive = derive(
  ['state'],
  (state) => String(state.value === 'updates' || state.value === 'updates,billing'),
);
export const GalleryCheckboxGroupDemo$CheckboxGroupControl_checked_derive = derive(
  ['state'],
  (state) => (state.value === 'updates' || state.value === 'updates,billing' ? '' : null),
);
export const GalleryCheckboxGroupDemo$CheckboxGroupControl_data_state_derive = derive(
  ['state'],
  (state) =>
    state.value === 'updates' || state.value === 'updates,billing' ? 'checked' : 'unchecked',
);
export const GalleryCheckboxGroupDemo$CheckboxGroupLabel_data_state_derive = derive(
  ['state'],
  (state) =>
    state.value === 'updates' || state.value === 'updates,billing' ? 'checked' : 'unchecked',
);
export const GalleryCheckboxGroupDemo$CheckboxGroupControl_aria_checked_derive_2 = derive(
  ['state'],
  (state) => String(state.value === 'billing' || state.value === 'updates,billing'),
);
export const GalleryCheckboxGroupDemo$CheckboxGroupControl_checked_derive_2 = derive(
  ['state'],
  (state) => (state.value === 'billing' || state.value === 'updates,billing' ? '' : null),
);
export const GalleryCheckboxGroupDemo$CheckboxGroupControl_data_state_derive_2 = derive(
  ['state'],
  (state) =>
    state.value === 'billing' || state.value === 'updates,billing' ? 'checked' : 'unchecked',
);
export const GalleryCheckboxGroupDemo$CheckboxGroupLabel_data_state_derive_2 = derive(
  ['state'],
  (state) =>
    state.value === 'billing' || state.value === 'updates,billing' ? 'checked' : 'unchecked',
);
export const GalleryCheckboxGroupDemo$output_text_derive = derive(
  ['state'],
  (state) => state.value || 'none',
);
