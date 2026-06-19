// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  dialogCancel as _dialogCancel,
  dialogCloseClick as _dialogCloseClick,
  dialogTriggerClick as _dialogTriggerClick,
} from '@kovojs/headless-ui/dialog';

export const GallerySheetDemo$SheetTrigger_click = handler((event, ctx) => {
  const result = _dialogTriggerClick(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});
export const GallerySheetDemo$SheetContent_cancel = handler((event, ctx) => {
  const result = _dialogCancel(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});
export const GallerySheetDemo$SheetClose_click = handler((event, ctx) => {
  const result = _dialogCloseClick(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});

export const GallerySheetDemo$SheetRoot_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GallerySheetDemo$SheetRoot_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GallerySheetDemo$SheetTrigger_aria_expanded_derive = derive(['state'], (state) =>
  state.open ? 'true' : 'false',
);
export const GallerySheetDemo$SheetTrigger_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GallerySheetDemo$SheetTrigger_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GallerySheetDemo$SheetContent_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GallerySheetDemo$SheetContent_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GallerySheetDemo$SheetClose_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GallerySheetDemo$SheetClose_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GallerySheetDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
