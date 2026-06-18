// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

export const GalleryFieldDemo$FieldControl_input = handler((event, ctx) => {
  const target = Object(event)['target'];
  const nextEmail = Object(target)['value']?.toString?.() ?? ctx.state.email;
  const checkValidity = Object(target)['checkValidity'];
  ctx.state.email = nextEmail;
  ctx.state.invalid =
    typeof checkValidity === 'function'
      ? !checkValidity.call(target)
      : !/.+@kovo\.sh/.test(nextEmail);
});
export const GalleryFieldDemo$FieldSelect_change = handler((event, ctx) => {
  ctx.state.plan = Object(event)['target']?.value?.toString?.() ?? ctx.state.plan;
});
export const GalleryFieldDemo$input_click = handler((event, ctx) => {
  const checked = Object(event)['target']?.checked;
  ctx.state.shippingDisabled = typeof checked === 'boolean' ? checked : !ctx.state.shippingDisabled;
});

export const GalleryFieldDemo$Field_data_invalid_derive = derive(['state'], (state) =>
  state.invalid ? '' : null,
);
export const GalleryFieldDemo$FieldControl_aria_describedby_derive = derive(['state'], (state) =>
  state.invalid
    ? 'gallery-interactive-field-email-description gallery-interactive-field-email-error'
    : 'gallery-interactive-field-email-description',
);
export const GalleryFieldDemo$FieldControl_aria_invalid_derive = derive(['state'], (state) =>
  state.invalid ? 'true' : null,
);
export const GalleryFieldDemo$FieldControl_data_invalid_derive = derive(['state'], (state) =>
  state.invalid ? '' : null,
);
export const GalleryFieldDemo$FieldControl_value_derive = derive(['state'], (state) => state.email);
export const GalleryFieldDemo$UiFieldError_hidden_derive = derive(['state'], (state) =>
  !state.invalid ? '' : null,
);
export const GalleryFieldDemo$UiFieldError_visible_derive = derive(
  ['state'],
  (state) => state.invalid,
);
export const GalleryFieldDemo$FieldSelect_value_derive = derive(['state'], (state) => state.plan);
export const GalleryFieldDemo$FieldSelectOption_selected_derive = derive(['state'], (state) =>
  state.plan === 'team' ? '' : null,
);
export const GalleryFieldDemo$FieldSelectOption_selected_derive_2 = derive(['state'], (state) =>
  state.plan === 'enterprise' ? '' : null,
);
export const GalleryFieldDemo$Fieldset_data_disabled_derive = derive(['state'], (state) =>
  state.shippingDisabled ? '' : null,
);
export const GalleryFieldDemo$Fieldset_disabled_derive = derive(['state'], (state) =>
  state.shippingDisabled ? '' : null,
);
export const GalleryFieldDemo$input_checked_derive = derive(['state'], (state) =>
  state.shippingDisabled ? '' : null,
);
