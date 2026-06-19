// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  dialogCancel as _dialogCancel,
  dialogCloseClick as _dialogCloseClick,
  dialogTriggerClick as _dialogTriggerClick,
} from '@kovojs/headless-ui/dialog';

export const GalleryDialogDemo$DialogTrigger_click = handler((event, ctx) => {
  const result = _dialogTriggerClick(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});
export const GalleryDialogDemo$DialogContent_cancel = handler((event, ctx) => {
  const result = _dialogCancel(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});
export const GalleryDialogDemo$DialogClose_click = handler((event, ctx) => {
  const result = _dialogCloseClick(Object(event), { open: ctx.state.open });
  if (!result?.changed) return;
  ctx.state.open = result.open;
});

export const GalleryDialogDemo$Dialog_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryDialogDemo$DialogTrigger_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryDialogDemo$DialogContent_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryDialogDemo$DialogClose_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryDialogDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
