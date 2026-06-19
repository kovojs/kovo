// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  radioGroupItemClick as _radioGroupItemClick,
  radioGroupKeyDown as _radioGroupKeyDown,
} from '@kovojs/headless-ui/radio-group';

export const GalleryRadioGroupDemo$RadioGroup_keydown = handler((event, ctx) => {
  const result = _radioGroupKeyDown(Object(event), {
    items: [{ value: 'email' }, { disabled: true, value: 'phone' }, { value: 'sms' }],
    value: ctx.state.value,
  });
  if (!result) return;
  ctx.state.value = result.value ?? ctx.state.value;
});
export const GalleryRadioGroupDemo$RadioGroupRadio_click = handler((event, ctx) => {
  const result = _radioGroupItemClick(Object(event), {
    itemValue: 'email',
    value: ctx.state.value,
  });
  if (!result) return;
  ctx.state.value = result.value ?? ctx.state.value;
});
export const GalleryRadioGroupDemo$RadioGroupRadio_click_2 = handler((event, ctx) => {
  const result = _radioGroupItemClick(Object(event), {
    itemValue: 'sms',
    value: ctx.state.value,
  });
  if (!result) return;
  ctx.state.value = result.value ?? ctx.state.value;
});

export const GalleryRadioGroupDemo$RadioGroup_value_derive = derive(
  ['state'],
  (state) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupItem_value_derive = derive(
  ['state'],
  (state) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupRadio_tabIndex_derive = derive(['state'], (state) =>
  state.value === 'email' ? 0 : -1,
);
export const GalleryRadioGroupDemo$RadioGroupRadio_value_derive = derive(
  ['state'],
  (state) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupLabel_value_derive = derive(
  ['state'],
  (state) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupItem_value_derive_2 = derive(
  ['state'],
  (state) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupRadio_value_derive_2 = derive(
  ['state'],
  (state) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupLabel_value_derive_2 = derive(
  ['state'],
  (state) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupItem_value_derive_3 = derive(
  ['state'],
  (state) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupRadio_tabIndex_derive_2 = derive(['state'], (state) =>
  state.value === 'sms' ? 0 : -1,
);
export const GalleryRadioGroupDemo$RadioGroupRadio_value_derive_3 = derive(
  ['state'],
  (state) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupLabel_value_derive_3 = derive(
  ['state'],
  (state) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupItem_data_state_derive = derive(['state'], (state) =>
  state.value === 'email' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$RadioGroupRadio_aria_checked_derive = derive(
  ['state'],
  (state) => (state.value === 'email' ? 'true' : 'false'),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_checked_derive = derive(['state'], (state) =>
  state.value === 'email' ? '' : null,
);
export const GalleryRadioGroupDemo$RadioGroupRadio_data_state_derive = derive(['state'], (state) =>
  state.value === 'email' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$RadioGroupLabel_data_state_derive = derive(['state'], (state) =>
  state.value === 'email' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$RadioGroupItem_data_state_derive_2 = derive(['state'], (state) =>
  state.value === 'phone' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$RadioGroupRadio_aria_checked_derive_2 = derive(
  ['state'],
  (state) => (state.value === 'phone' ? 'true' : 'false'),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_checked_derive_2 = derive(['state'], (state) =>
  state.value === 'phone' ? '' : null,
);
export const GalleryRadioGroupDemo$RadioGroupRadio_data_state_derive_2 = derive(
  ['state'],
  (state) => (state.value === 'phone' ? 'checked' : 'unchecked'),
);
export const GalleryRadioGroupDemo$RadioGroupLabel_data_state_derive_2 = derive(
  ['state'],
  (state) => (state.value === 'phone' ? 'checked' : 'unchecked'),
);
export const GalleryRadioGroupDemo$RadioGroupItem_data_state_derive_3 = derive(['state'], (state) =>
  state.value === 'sms' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$RadioGroupRadio_aria_checked_derive_3 = derive(
  ['state'],
  (state) => (state.value === 'sms' ? 'true' : 'false'),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_checked_derive_3 = derive(['state'], (state) =>
  state.value === 'sms' ? '' : null,
);
export const GalleryRadioGroupDemo$RadioGroupRadio_data_state_derive_3 = derive(
  ['state'],
  (state) => (state.value === 'sms' ? 'checked' : 'unchecked'),
);
export const GalleryRadioGroupDemo$RadioGroupLabel_data_state_derive_3 = derive(
  ['state'],
  (state) => (state.value === 'sms' ? 'checked' : 'unchecked'),
);
