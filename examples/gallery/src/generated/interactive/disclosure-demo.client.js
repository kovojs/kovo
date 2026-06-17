// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import { disclosureTriggerClick as _disclosureTriggerClick } from '@kovojs/headless-ui/primitives';

export const GalleryDisclosureDemo$button_click = handler((event, ctx) => {
  const result = _disclosureTriggerClick(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});

export const GalleryDisclosureDemo$button_aria_expanded_derive = derive(['state'], (state) =>
  String(state.open),
);
export const GalleryDisclosureDemo$button_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDisclosureDemo$div_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDisclosureDemo$div_hidden_derive = derive(['state'], (state) =>
  !state.open ? '' : null,
);
