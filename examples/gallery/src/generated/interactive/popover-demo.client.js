// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import { popoverBeforeToggle as _popoverBeforeToggle } from '@kovojs/headless-ui/popover';

export const GalleryPopoverDemo$div_beforetoggle = handler((event, ctx) => {
  const result = _popoverBeforeToggle(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});

export const GalleryPopoverDemo$section_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryPopoverDemo$button_aria_expanded_derive = derive(['state'], (state) =>
  state.open ? 'true' : 'false',
);
export const GalleryPopoverDemo$button_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryPopoverDemo$div_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryPopoverDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
