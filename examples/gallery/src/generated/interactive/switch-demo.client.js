// @kovojs-ir
import { derive, handler } from '@kovojs/runtime';

import { switchTriggerClick as _switchTriggerClick } from '@kovojs/headless-ui/primitives';

export const GallerySwitchDemo$input_click = handler((event, ctx) => {
  const result = _switchTriggerClick(Object(event), { checked: ctx.state.checked });
  if (!result) return;
  ctx.state.checked = result.checked;
});
export const GallerySwitchDemo$input_keydown = handler((event, ctx) => {
  if (Object(event)['key'] !== 'Enter') return;
  const result = _switchTriggerClick(Object(event), { checked: ctx.state.checked });
  if (!result) return;
  Object(event)['preventDefault']?.call(event);
  ctx.state.checked = result.checked;
});

export const GallerySwitchDemo$input_aria_checked_derive = derive(['state'], (state) =>
  String(state.checked),
);
export const GallerySwitchDemo$input_checked_derive = derive(['state'], (state) =>
  state.checked ? '' : null,
);
export const GallerySwitchDemo$input_data_state_derive = derive(['state'], (state) =>
  state.checked ? 'checked' : 'unchecked',
);
export const GallerySwitchDemo$output_text_derive = derive(['state'], (state) =>
  state.checked ? 'on' : 'off',
);
