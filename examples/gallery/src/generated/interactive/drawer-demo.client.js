// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  dialogCancel as _dialogCancel,
  dialogCloseClick as _dialogCloseClick,
  dialogTriggerClick as _dialogTriggerClick,
} from '@kovojs/headless-ui/dialog';

export const GalleryDrawerDemo$DrawerTrigger_click = handler((event, ctx) => {
  const result = _dialogTriggerClick(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});
export const GalleryDrawerDemo$DrawerContent_cancel = handler((event, ctx) => {
  const result = _dialogCancel(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});
export const GalleryDrawerDemo$DrawerClose_click = handler((event, ctx) => {
  const result = _dialogCloseClick(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});

export const GalleryDrawerDemo$DrawerRoot_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDrawerDemo$DrawerRoot_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryDrawerDemo$DrawerTrigger_aria_expanded_derive = derive(['state'], (state) =>
  state.open ? 'true' : 'false',
);
export const GalleryDrawerDemo$DrawerTrigger_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDrawerDemo$DrawerTrigger_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryDrawerDemo$DrawerContent_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDrawerDemo$DrawerContent_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryDrawerDemo$DrawerClose_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDrawerDemo$DrawerClose_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryDrawerDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
