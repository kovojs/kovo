// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import { disclosureTriggerClick as _disclosureTriggerClick } from '@kovojs/ui/disclosure';

export const GalleryDisclosureDemo$DisclosureTrigger_click = handler((event, ctx) => {
  const result = _disclosureTriggerClick(Object(event), { open: ctx.state.open });
  if (!result) return;
  ctx.state.open = result.open;
});

export const GalleryDisclosureDemo$Disclosure_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryDisclosureDemo$DisclosureTrigger_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryDisclosureDemo$DisclosureContent_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
