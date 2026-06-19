// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import { toolbarKeyDown as _toolbarKeyDown } from '@kovojs/headless-ui/toolbar';

export const GalleryToolbarDemo$Toolbar_keydown = handler((event, ctx) => {
  const result = _toolbarKeyDown(Object(event), {
    activeValue: ctx.state.activeValue,
    items: [{ value: 'bold' }, { disabled: true, value: 'italic' }, { value: 'link' }],
  });
  if (!result?.value) return;
  ctx.state.activeValue = result.value;
  const root = Object(event)['target']?.closest?.('[role="toolbar"]');
  const next = Object(root)?.querySelector?.(`[value="${result.value}"]`);
  Object(next)['focus']?.call(next);
});
export const GalleryToolbarDemo$ToolbarButton_click = handler((_event, ctx) => {
  ctx.state.activeValue = 'bold';
  ctx.state.pressedValue = ctx.state.pressedValue === 'bold' ? '' : 'bold';
});
export const GalleryToolbarDemo$ToolbarButton_click_2 = handler((_event, ctx) => {
  ctx.state.activeValue = 'link';
  ctx.state.pressedValue = ctx.state.pressedValue === 'link' ? '' : 'link';
});

export const GalleryToolbarDemo$ToolbarButton_aria_pressed_derive = derive(['state'], (state) =>
  String(state.pressedValue === 'bold'),
);
export const GalleryToolbarDemo$ToolbarButton_data_pressed_derive = derive(['state'], (state) =>
  String(state.pressedValue === 'bold'),
);
export const GalleryToolbarDemo$ToolbarButton_pressed_derive = derive(
  ['state'],
  (state) => state.pressedValue === 'bold',
);
export const GalleryToolbarDemo$ToolbarButton_tabIndex_derive = derive(['state'], (state) =>
  state.activeValue === 'bold' ? 0 : -1,
);
export const GalleryToolbarDemo$ToolbarButton_aria_pressed_derive_2 = derive(['state'], (state) =>
  String(state.pressedValue === 'link'),
);
export const GalleryToolbarDemo$ToolbarButton_data_pressed_derive_2 = derive(['state'], (state) =>
  String(state.pressedValue === 'link'),
);
export const GalleryToolbarDemo$ToolbarButton_pressed_derive_2 = derive(
  ['state'],
  (state) => state.pressedValue === 'link',
);
export const GalleryToolbarDemo$ToolbarButton_tabIndex_derive_2 = derive(['state'], (state) =>
  state.activeValue === 'link' ? 0 : -1,
);
export const GalleryToolbarDemo$output_text_derive = derive(
  ['state'],
  (state) => state.pressedValue || 'none',
);
