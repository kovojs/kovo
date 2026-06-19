// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  otpFieldInput as _otpFieldInput,
  otpFieldKeyDown as _otpFieldKeyDown,
  otpFieldPaste as _otpFieldPaste,
} from '@kovojs/headless-ui/otp-field';

export const GalleryOtpFieldDemo$OtpFieldInput_input = handler((event, ctx) => {
  const result = _otpFieldInput(Object(event), {
    length: 4,
    slotIndex: 0,
    value: ctx.state.value,
  });
  if (!result) return;
  if ('value' in result && typeof result.value === 'string') ctx.state.value = result.value;
  if (typeof result.focusIndex === 'number') ctx.state.activeSlot = result.focusIndex;
});
export const GalleryOtpFieldDemo$OtpFieldInput_keydown = handler((event, ctx) => {
  const result = _otpFieldKeyDown(Object(event), {
    length: 4,
    slotIndex: 0,
    value: ctx.state.value,
  });
  if (!result) return;
  if ('value' in result && typeof result.value === 'string') ctx.state.value = result.value;
  if (typeof result.focusIndex === 'number') ctx.state.activeSlot = result.focusIndex;
});
export const GalleryOtpFieldDemo$OtpFieldInput_paste = handler((event, ctx) => {
  const result = _otpFieldPaste(Object(event), {
    length: 4,
    slotIndex: 0,
    value: ctx.state.value,
  });
  if (!result) return;
  if ('value' in result && typeof result.value === 'string') ctx.state.value = result.value;
  if (typeof result.focusIndex === 'number') ctx.state.activeSlot = result.focusIndex;
});
export const GalleryOtpFieldDemo$OtpFieldInput_input_2 = handler((event, ctx) => {
  const result = _otpFieldInput(Object(event), {
    length: 4,
    slotIndex: 1,
    value: ctx.state.value,
  });
  if (!result) return;
  if ('value' in result && typeof result.value === 'string') ctx.state.value = result.value;
  if (typeof result.focusIndex === 'number') ctx.state.activeSlot = result.focusIndex;
});
export const GalleryOtpFieldDemo$OtpFieldInput_keydown_2 = handler((event, ctx) => {
  const result = _otpFieldKeyDown(Object(event), {
    length: 4,
    slotIndex: 1,
    value: ctx.state.value,
  });
  if (!result) return;
  if ('value' in result && typeof result.value === 'string') ctx.state.value = result.value;
  if (typeof result.focusIndex === 'number') ctx.state.activeSlot = result.focusIndex;
});
export const GalleryOtpFieldDemo$OtpFieldInput_paste_2 = handler((event, ctx) => {
  const result = _otpFieldPaste(Object(event), {
    length: 4,
    slotIndex: 1,
    value: ctx.state.value,
  });
  if (!result) return;
  if ('value' in result && typeof result.value === 'string') ctx.state.value = result.value;
  if (typeof result.focusIndex === 'number') ctx.state.activeSlot = result.focusIndex;
});
export const GalleryOtpFieldDemo$OtpFieldInput_input_3 = handler((event, ctx) => {
  const result = _otpFieldInput(Object(event), {
    length: 4,
    slotIndex: 2,
    value: ctx.state.value,
  });
  if (!result) return;
  if ('value' in result && typeof result.value === 'string') ctx.state.value = result.value;
  if (typeof result.focusIndex === 'number') ctx.state.activeSlot = result.focusIndex;
});
export const GalleryOtpFieldDemo$OtpFieldInput_keydown_3 = handler((event, ctx) => {
  const result = _otpFieldKeyDown(Object(event), {
    length: 4,
    slotIndex: 2,
    value: ctx.state.value,
  });
  if (!result) return;
  if ('value' in result && typeof result.value === 'string') ctx.state.value = result.value;
  if (typeof result.focusIndex === 'number') ctx.state.activeSlot = result.focusIndex;
});
export const GalleryOtpFieldDemo$OtpFieldInput_paste_3 = handler((event, ctx) => {
  const result = _otpFieldPaste(Object(event), {
    length: 4,
    slotIndex: 2,
    value: ctx.state.value,
  });
  if (!result) return;
  if ('value' in result && typeof result.value === 'string') ctx.state.value = result.value;
  if (typeof result.focusIndex === 'number') ctx.state.activeSlot = result.focusIndex;
});
export const GalleryOtpFieldDemo$OtpFieldInput_input_4 = handler((event, ctx) => {
  const result = _otpFieldInput(Object(event), {
    length: 4,
    slotIndex: 3,
    value: ctx.state.value,
  });
  if (!result) return;
  if ('value' in result && typeof result.value === 'string') ctx.state.value = result.value;
  if (typeof result.focusIndex === 'number') ctx.state.activeSlot = result.focusIndex;
});
export const GalleryOtpFieldDemo$OtpFieldInput_keydown_4 = handler((event, ctx) => {
  const result = _otpFieldKeyDown(Object(event), {
    length: 4,
    slotIndex: 3,
    value: ctx.state.value,
  });
  if (!result) return;
  if ('value' in result && typeof result.value === 'string') ctx.state.value = result.value;
  if (typeof result.focusIndex === 'number') ctx.state.activeSlot = result.focusIndex;
});
export const GalleryOtpFieldDemo$OtpFieldInput_paste_4 = handler((event, ctx) => {
  const result = _otpFieldPaste(Object(event), {
    length: 4,
    slotIndex: 3,
    value: ctx.state.value,
  });
  if (!result) return;
  if ('value' in result && typeof result.value === 'string') ctx.state.value = result.value;
  if (typeof result.focusIndex === 'number') ctx.state.activeSlot = result.focusIndex;
});

export const GalleryOtpFieldDemo$OtpField_data_complete_derive = derive(['state'], (state) =>
  state.value.length === 4 ? '' : null,
);
export const GalleryOtpFieldDemo$OtpFieldHiddenInput_data_complete_derive = derive(
  ['state'],
  (state) => (state.value.length === 4 ? '' : null),
);
export const GalleryOtpFieldDemo$OtpFieldHiddenInput_value_derive = derive(
  ['state'],
  (state) => state.value,
);
export const GalleryOtpFieldDemo$OtpFieldInput_data_complete_derive = derive(['state'], (state) =>
  state.value.length === 4 ? '' : null,
);
export const GalleryOtpFieldDemo$OtpFieldInput_data_filled_derive = derive(['state'], (state) =>
  (state.value[0] ?? '') === '' ? null : '',
);
export const GalleryOtpFieldDemo$OtpFieldInput_tabIndex_derive = derive(['state'], (state) =>
  state.activeSlot === 0 ? 0 : -1,
);
export const GalleryOtpFieldDemo$OtpFieldInput_value_derive = derive(
  ['state'],
  (state) => state.value[0] ?? '',
);
export const GalleryOtpFieldDemo$OtpFieldInput_data_complete_derive_2 = derive(['state'], (state) =>
  state.value.length === 4 ? '' : null,
);
export const GalleryOtpFieldDemo$OtpFieldInput_data_filled_derive_2 = derive(['state'], (state) =>
  (state.value[1] ?? '') === '' ? null : '',
);
export const GalleryOtpFieldDemo$OtpFieldInput_tabIndex_derive_2 = derive(['state'], (state) =>
  state.activeSlot === 1 ? 0 : -1,
);
export const GalleryOtpFieldDemo$OtpFieldInput_value_derive_2 = derive(
  ['state'],
  (state) => state.value[1] ?? '',
);
export const GalleryOtpFieldDemo$OtpFieldInput_data_complete_derive_3 = derive(['state'], (state) =>
  state.value.length === 4 ? '' : null,
);
export const GalleryOtpFieldDemo$OtpFieldInput_data_filled_derive_3 = derive(['state'], (state) =>
  (state.value[2] ?? '') === '' ? null : '',
);
export const GalleryOtpFieldDemo$OtpFieldInput_tabIndex_derive_3 = derive(['state'], (state) =>
  state.activeSlot === 2 ? 0 : -1,
);
export const GalleryOtpFieldDemo$OtpFieldInput_value_derive_3 = derive(
  ['state'],
  (state) => state.value[2] ?? '',
);
export const GalleryOtpFieldDemo$OtpFieldInput_data_complete_derive_4 = derive(['state'], (state) =>
  state.value.length === 4 ? '' : null,
);
export const GalleryOtpFieldDemo$OtpFieldInput_data_filled_derive_4 = derive(['state'], (state) =>
  (state.value[3] ?? '') === '' ? null : '',
);
export const GalleryOtpFieldDemo$OtpFieldInput_tabIndex_derive_4 = derive(['state'], (state) =>
  state.activeSlot === 3 ? 0 : -1,
);
export const GalleryOtpFieldDemo$OtpFieldInput_value_derive_4 = derive(
  ['state'],
  (state) => state.value[3] ?? '',
);
