// @kovojs-ir
import { derive, handler } from '@kovojs/runtime';

export const GalleryFieldDemo$input_input = handler((event, ctx) => {
  const target = Object(event)['target'];
  const nextEmail = Object(target)['value']?.toString?.() ?? ctx.state.email;
  const checkValidity = Object(target)['checkValidity'];
  ctx.state.email = nextEmail;
  ctx.state.invalid =
    typeof checkValidity === 'function'
      ? !checkValidity.call(target)
      : !/.+@kovo\.sh/.test(nextEmail);
});
export const GalleryFieldDemo$select_change = handler((event, ctx) => {
  ctx.state.plan = Object(event)['target']?.value?.toString?.() ?? ctx.state.plan;
});
export const GalleryFieldDemo$input_click = handler((event, ctx) => {
  const checked = Object(event)['target']?.checked;
  ctx.state.shippingDisabled = typeof checked === 'boolean' ? checked : !ctx.state.shippingDisabled;
});

export const GalleryFieldDemo$div_data_invalid_derive = derive(['state'], (state) =>
  state.invalid ? '' : null,
);
export const GalleryFieldDemo$input_aria_describedby_derive = derive(['state'], (state) =>
  state.invalid
    ? 'gallery-interactive-field-email-description gallery-interactive-field-email-error'
    : 'gallery-interactive-field-email-description',
);
export const GalleryFieldDemo$input_aria_invalid_derive = derive(['state'], (state) =>
  state.invalid ? 'true' : null,
);
export const GalleryFieldDemo$input_data_invalid_derive = derive(['state'], (state) =>
  state.invalid ? '' : null,
);
export const GalleryFieldDemo$input_value_derive = derive(['state'], (state) => state.email);
export const GalleryFieldDemo$p_hidden_derive = derive(['state'], (state) =>
  !state.invalid ? '' : null,
);
export const GalleryFieldDemo$select_value_derive = derive(['state'], (state) => state.plan);
export const GalleryFieldDemo$option_selected_derive = derive(['state'], (state) =>
  state.plan === 'team' ? '' : null,
);
export const GalleryFieldDemo$option_selected_derive_2 = derive(['state'], (state) =>
  state.plan === 'enterprise' ? '' : null,
);
export const GalleryFieldDemo$fieldset_data_disabled_derive = derive(['state'], (state) =>
  state.shippingDisabled ? '' : null,
);
export const GalleryFieldDemo$fieldset_disabled_derive = derive(['state'], (state) =>
  state.shippingDisabled ? '' : null,
);
export const GalleryFieldDemo$input_checked_derive = derive(['state'], (state) =>
  state.shippingDisabled ? '' : null,
);
