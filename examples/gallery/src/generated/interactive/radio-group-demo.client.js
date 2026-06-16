// @kovojs-ir
import { derive, handler } from '@kovojs/runtime';

import {
  radioGroupItemClick as _radioGroupItemClick,
  radioGroupKeyDown as _radioGroupKeyDown,
} from '@kovojs/headless-ui/primitives';

export const GalleryRadioGroupDemo$div_keydown = handler((event, ctx) => {
  const result = _radioGroupKeyDown(Object(event), {
    items: [{ value: 'email' }, { disabled: true, value: 'phone' }, { value: 'sms' }],
    value: ctx.state.value,
  });
  if (!result) return;
  ctx.state.value = result.value ?? ctx.state.value;
});
export const GalleryRadioGroupDemo$input_click = handler((event, ctx) => {
  const result = _radioGroupItemClick(Object(event), {
    itemValue: 'email',
    value: ctx.state.value,
  });
  if (!result) return;
  ctx.state.value = result.value ?? ctx.state.value;
});
export const GalleryRadioGroupDemo$input_click_2 = handler((event, ctx) => {
  const result = _radioGroupItemClick(Object(event), {
    itemValue: 'sms',
    value: ctx.state.value,
  });
  if (!result) return;
  ctx.state.value = result.value ?? ctx.state.value;
});

export const GalleryRadioGroupDemo$div_data_state_derive = derive(['state'], (state) =>
  state.value === 'email' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$input_aria_checked_derive = derive(['state'], (state) =>
  String(state.value === 'email'),
);
export const GalleryRadioGroupDemo$input_checked_derive = derive(['state'], (state) =>
  state.value === 'email' ? '' : null,
);
export const GalleryRadioGroupDemo$input_data_state_derive = derive(['state'], (state) =>
  state.value === 'email' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$input_tabIndex_derive = derive(['state'], (state) =>
  state.value === 'email' ? 0 : -1,
);
export const GalleryRadioGroupDemo$label_data_state_derive = derive(['state'], (state) =>
  state.value === 'email' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$div_data_state_derive_2 = derive(['state'], (state) =>
  state.value === 'phone' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$input_aria_checked_derive_2 = derive(['state'], (state) =>
  String(state.value === 'phone'),
);
export const GalleryRadioGroupDemo$input_checked_derive_2 = derive(['state'], (state) =>
  state.value === 'phone' ? '' : null,
);
export const GalleryRadioGroupDemo$input_data_state_derive_2 = derive(['state'], (state) =>
  state.value === 'phone' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$label_data_state_derive_2 = derive(['state'], (state) =>
  state.value === 'phone' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$div_data_state_derive_3 = derive(['state'], (state) =>
  state.value === 'sms' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$input_aria_checked_derive_3 = derive(['state'], (state) =>
  String(state.value === 'sms'),
);
export const GalleryRadioGroupDemo$input_checked_derive_3 = derive(['state'], (state) =>
  state.value === 'sms' ? '' : null,
);
export const GalleryRadioGroupDemo$input_data_state_derive_3 = derive(['state'], (state) =>
  state.value === 'sms' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$input_tabIndex_derive_2 = derive(['state'], (state) =>
  state.value === 'sms' ? 0 : -1,
);
export const GalleryRadioGroupDemo$label_data_state_derive_3 = derive(['state'], (state) =>
  state.value === 'sms' ? 'checked' : 'unchecked',
);
