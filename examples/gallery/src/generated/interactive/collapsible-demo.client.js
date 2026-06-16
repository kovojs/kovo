// @kovojs-ir
import { derive, handler } from '@kovojs/runtime';

import { collapsibleTriggerClick as _collapsibleTriggerClick } from '@kovojs/headless-ui/primitives';

export const GalleryCollapsibleDemo$summary_click = handler((event, ctx) => {
  const result = _collapsibleTriggerClick(Object(event), { open: ctx.state.open });
  if (!result) return;
  Object(event)['preventDefault']?.call(event);
  ctx.state.open = result.open;
});

export const GalleryCollapsibleDemo$details_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCollapsibleDemo$details_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryCollapsibleDemo$summary_aria_expanded_derive = derive(['state'], (state) =>
  String(state.open),
);
export const GalleryCollapsibleDemo$summary_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCollapsibleDemo$div_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
