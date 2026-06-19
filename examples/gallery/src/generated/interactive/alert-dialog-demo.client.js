// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  alertDialogActionClick as _alertDialogActionClick,
  alertDialogCancel as _alertDialogCancel,
  alertDialogCancelClick as _alertDialogCancelClick,
  alertDialogTriggerClick as _alertDialogTriggerClick,
} from '@kovojs/ui/alert-dialog';

export const GalleryAlertDialogDemo$AlertDialogTrigger_click = handler((event, ctx) => {
  const result = _alertDialogTriggerClick(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});
export const GalleryAlertDialogDemo$AlertDialogContent_cancel = handler((event, ctx) => {
  const result = _alertDialogCancel(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});
export const GalleryAlertDialogDemo$AlertDialogCancel_click = handler((event, ctx) => {
  const result = _alertDialogCancelClick(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});
export const GalleryAlertDialogDemo$AlertDialogAction_click = handler((event, ctx) => {
  const result = _alertDialogActionClick(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});

export const GalleryAlertDialogDemo$AlertDialog_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryAlertDialogDemo$AlertDialog_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryAlertDialogDemo$AlertDialogTrigger_aria_expanded_derive = derive(
  ['state'],
  (state) => (state.open ? 'true' : 'false'),
);
export const GalleryAlertDialogDemo$AlertDialogTrigger_data_state_derive = derive(
  ['state'],
  (state) => (state.open ? 'open' : 'closed'),
);
export const GalleryAlertDialogDemo$AlertDialogTrigger_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryAlertDialogDemo$AlertDialogContent_data_state_derive = derive(
  ['state'],
  (state) => (state.open ? 'open' : 'closed'),
);
export const GalleryAlertDialogDemo$AlertDialogContent_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryAlertDialogDemo$AlertDialogCancel_data_state_derive = derive(
  ['state'],
  (state) => (state.open ? 'open' : 'closed'),
);
export const GalleryAlertDialogDemo$AlertDialogCancel_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryAlertDialogDemo$AlertDialogAction_data_state_derive = derive(
  ['state'],
  (state) => (state.open ? 'open' : 'closed'),
);
export const GalleryAlertDialogDemo$AlertDialogAction_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryAlertDialogDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
