// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import { collapsibleTriggerClick as _collapsibleTriggerClick } from '@kovojs/ui/collapsible';

export const GalleryCollapsibleDemo$CollapsibleTrigger_click = handler((event, ctx) => {
  const result = _collapsibleTriggerClick(Object(event), { open: ctx.state.open });
  if (!result) return;
  Object(event)['preventDefault']?.call(event);
  ctx.state.open = result.open;
});

export const GalleryCollapsibleDemo$Collapsible_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryCollapsibleDemo$CollapsibleTrigger_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryCollapsibleDemo$CollapsibleContent_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryCollapsibleDemo$Collapsible_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCollapsibleDemo$CollapsibleTrigger_aria_expanded_derive = derive(
  ['state'],
  (state) => (state.open ? 'true' : 'false'),
);
export const GalleryCollapsibleDemo$CollapsibleTrigger_data_state_derive = derive(
  ['state'],
  (state) => (state.open ? 'open' : 'closed'),
);
export const GalleryCollapsibleDemo$CollapsibleContent_data_state_derive = derive(
  ['state'],
  (state) => (state.open ? 'open' : 'closed'),
);
