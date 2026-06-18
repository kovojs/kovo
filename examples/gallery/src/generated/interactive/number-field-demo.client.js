// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  numberFieldDecrementClick as _numberFieldDecrementClick,
  numberFieldIncrementClick as _numberFieldIncrementClick,
  numberFieldInput as _numberFieldInput,
  numberFieldKeyDown as _numberFieldKeyDown,
} from '@kovojs/headless-ui/number-field';

export const GalleryNumberFieldDemo$button_click = handler((event, ctx) => {
  const result = _numberFieldDecrementClick(Object(event), {
    max: 5,
    min: 0,
    smallStep: 1,
    step: 1,
    value: ctx.state.value,
  });
  if (!result) return;
  ctx.state.value = result.value ?? 0;
});
export const GalleryNumberFieldDemo$input_input = handler((event, ctx) => {
  const result = _numberFieldInput(Object(event), {
    max: 5,
    min: 0,
    smallStep: 1,
    step: 1,
    value: ctx.state.value,
  });
  if (!result) return;
  ctx.state.value = result.value ?? 0;
});
export const GalleryNumberFieldDemo$input_keydown = handler((event, ctx) => {
  const result = _numberFieldKeyDown(Object(event), {
    max: 5,
    min: 0,
    smallStep: 1,
    step: 1,
    value: ctx.state.value,
  });
  if (!result) return;
  ctx.state.value = result.value ?? 0;
});
export const GalleryNumberFieldDemo$button_click_2 = handler((event, ctx) => {
  const result = _numberFieldIncrementClick(Object(event), {
    max: 5,
    min: 0,
    smallStep: 1,
    step: 1,
    value: ctx.state.value,
  });
  if (!result) return;
  ctx.state.value = result.value ?? 0;
});

export const GalleryNumberFieldDemo$button_data_disabled_derive = derive(['state'], (state) =>
  state.value <= 0 ? '' : null,
);
export const GalleryNumberFieldDemo$button_disabled_derive = derive(['state'], (state) =>
  state.value <= 0 ? '' : null,
);
export const GalleryNumberFieldDemo$input_value_derive = derive(['state'], (state) => state.value);
export const GalleryNumberFieldDemo$button_data_disabled_derive_2 = derive(['state'], (state) =>
  state.value >= 5 ? '' : null,
);
export const GalleryNumberFieldDemo$button_disabled_derive_2 = derive(['state'], (state) =>
  state.value >= 5 ? '' : null,
);
export const GalleryNumberFieldDemo$output_text_derive = derive(['state'], (state) =>
  String(state.value),
);
