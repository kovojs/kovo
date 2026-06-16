// @kovojs-ir
import { derive, handler } from '@kovojs/runtime';

import {
  alertDialogActionClick as _alertDialogActionClick,
  alertDialogCancel as _alertDialogCancel,
  alertDialogCancelClick as _alertDialogCancelClick,
  alertDialogTriggerClick as _alertDialogTriggerClick,
} from '@kovojs/headless-ui/primitives';

export const GalleryAlertDialogDemo$button_click = handler((event, ctx) => {
  const result = _alertDialogTriggerClick(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});
export const GalleryAlertDialogDemo$dialog_cancel = handler((event, ctx) => {
  const result = _alertDialogCancel(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});
export const GalleryAlertDialogDemo$button_click_2 = handler((event, ctx) => {
  const result = _alertDialogCancelClick(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});
export const GalleryAlertDialogDemo$button_click_3 = handler((event, ctx) => {
  const result = _alertDialogActionClick(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});

export const GalleryAlertDialogDemo$section_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryAlertDialogDemo$button_aria_expanded_derive = derive(['state'], (state) =>
  state.open ? 'true' : 'false',
);
export const GalleryAlertDialogDemo$button_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryAlertDialogDemo$dialog_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryAlertDialogDemo$dialog_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryAlertDialogDemo$button_data_state_derive_2 = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryAlertDialogDemo$button_data_state_derive_3 = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryAlertDialogDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
