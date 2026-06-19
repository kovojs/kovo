// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import { switchTriggerClick as _switchTriggerClick } from '@kovojs/ui/switch';

export const GallerySwitchDemo$Switch_click = handler((event, ctx) => {
  const result = _switchTriggerClick(Object(event), { checked: ctx.state.checked });
  if (!result) return;
  ctx.state.checked = result.checked;
});
export const GallerySwitchDemo$Switch_keydown = handler((event, ctx) => {
  if (Object(event)['key'] !== 'Enter') return;
  const result = _switchTriggerClick(Object(event), { checked: ctx.state.checked });
  if (!result) return;
  Object(event)['preventDefault']?.call(event);
  ctx.state.checked = result.checked;
});

export const GallerySwitchDemo$Switch_checked_derive = derive(['state'], (state) =>
  state.checked ? '' : null,
);
export const GallerySwitchDemo$output_text_derive = derive(['state'], (state) =>
  state.checked ? 'on' : 'off',
);
