// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  dialogCancel as _dialogCancel,
  dialogCloseClick as _dialogCloseClick,
  dialogTriggerClick as _dialogTriggerClick,
} from '@kovojs/headless-ui/dialog';

export const GallerySheetDemo$button_click = handler((event, ctx) => {
  const result = _dialogTriggerClick(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});
export const GallerySheetDemo$dialog_cancel = handler((event, ctx) => {
  const result = _dialogCancel(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});
export const GallerySheetDemo$button_click_2 = handler((event, ctx) => {
  const result = _dialogCloseClick(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});

export const GallerySheetDemo$section_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GallerySheetDemo$button_aria_expanded_derive = derive(['state'], (state) =>
  state.open ? 'true' : 'false',
);
export const GallerySheetDemo$button_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GallerySheetDemo$dialog_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GallerySheetDemo$dialog_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GallerySheetDemo$button_data_state_derive_2 = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GallerySheetDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
