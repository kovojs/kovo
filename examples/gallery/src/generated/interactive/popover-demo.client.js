// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import { popoverBeforeToggle as _popoverBeforeToggle } from '@kovojs/headless-ui/popover';

export const GalleryPopoverDemo$PopoverContent_beforetoggle = handler((event, ctx) => {
  const result = _popoverBeforeToggle(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});

export const GalleryPopoverDemo$Popover_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryPopoverDemo$PopoverTrigger_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryPopoverDemo$PopoverContent_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryPopoverDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
