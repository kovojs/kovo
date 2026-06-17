// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  dialogCancel as _dialogCancel,
  dialogCloseClick as _dialogCloseClick,
  dialogTriggerClick as _dialogTriggerClick,
} from '@kovojs/headless-ui/primitives';

export const GalleryDrawerDemo$button_click = handler((event, ctx) => {
  const result = _dialogTriggerClick(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});
export const GalleryDrawerDemo$dialog_cancel = handler((event, ctx) => {
  const result = _dialogCancel(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});
export const GalleryDrawerDemo$button_click_2 = handler((event, ctx) => {
  const result = _dialogCloseClick(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});

export const GalleryDrawerDemo$section_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDrawerDemo$button_aria_expanded_derive = derive(['state'], (state) =>
  state.open ? 'true' : 'false',
);
export const GalleryDrawerDemo$button_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDrawerDemo$dialog_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDrawerDemo$dialog_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryDrawerDemo$button_data_state_derive_2 = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDrawerDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
