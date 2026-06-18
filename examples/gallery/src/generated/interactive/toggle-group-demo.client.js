// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  toggleGroupItemClick as _toggleGroupItemClick,
  toggleGroupKeyDown as _toggleGroupKeyDown,
} from '@kovojs/ui/toggle-group';

export const GalleryToggleGroupDemo$ToggleGroup_keydown = handler((event, ctx) => {
  const result = _toggleGroupKeyDown(Object(event), {
    activeValue: ctx.state.activeValue,
    items: [{ value: 'bold' }, { disabled: true, value: 'strike' }, { value: 'italic' }],
    type: 'multiple',
    value:
      ctx.state.value === 'bold,italic'
        ? ['bold', 'italic']
        : ctx.state.value === ''
          ? []
          : [ctx.state.value],
  });
  if (!result?.value) return;
  ctx.state.activeValue = result.value;
  const root = Object(event)['target']?.closest?.('[role="group"]');
  const next = Object(root)?.querySelector?.(`[value="${result.value}"]`);
  Object(next)['focus']?.call(next);
});
export const GalleryToggleGroupDemo$ToggleGroupButton_click = handler((event, ctx) => {
  const result = _toggleGroupItemClick(Object(event), {
    itemValue: 'bold',
    items: [{ value: 'bold' }, { disabled: true, value: 'strike' }, { value: 'italic' }],
    type: 'multiple',
    value:
      ctx.state.value === 'bold,italic'
        ? ['bold', 'italic']
        : ctx.state.value === ''
          ? []
          : [ctx.state.value],
  });
  if (!result) return;
  ctx.state.activeValue = 'bold';
  ctx.state.value = result.value?.toString() ?? '';
});
export const GalleryToggleGroupDemo$ToggleGroupButton_click_2 = handler((event, ctx) => {
  const result = _toggleGroupItemClick(Object(event), {
    itemValue: 'italic',
    items: [{ value: 'bold' }, { disabled: true, value: 'strike' }, { value: 'italic' }],
    type: 'multiple',
    value:
      ctx.state.value === 'bold,italic'
        ? ['bold', 'italic']
        : ctx.state.value === ''
          ? []
          : [ctx.state.value],
  });
  if (!result) return;
  ctx.state.activeValue = 'italic';
  ctx.state.value = result.value?.toString() ?? '';
});

export const GalleryToggleGroupDemo$ToggleGroupButton_aria_pressed_derive = derive(
  ['state'],
  (state) => String(state.value === 'bold' || state.value === 'bold,italic'),
);
export const GalleryToggleGroupDemo$ToggleGroupButton_data_state_derive = derive(
  ['state'],
  (state) => (state.value === 'bold' || state.value === 'bold,italic' ? 'pressed' : 'off'),
);
export const GalleryToggleGroupDemo$ToggleGroupButton_tabIndex_derive = derive(['state'], (state) =>
  state.activeValue === 'bold' ? 0 : -1,
);
export const GalleryToggleGroupDemo$ToggleGroupButton_aria_pressed_derive_2 = derive(
  ['state'],
  (state) => String(state.value === 'italic' || state.value === 'bold,italic'),
);
export const GalleryToggleGroupDemo$ToggleGroupButton_data_state_derive_2 = derive(
  ['state'],
  (state) => (state.value === 'italic' || state.value === 'bold,italic' ? 'pressed' : 'off'),
);
export const GalleryToggleGroupDemo$ToggleGroupButton_tabIndex_derive_2 = derive(
  ['state'],
  (state) => (state.activeValue === 'italic' ? 0 : -1),
);
export const GalleryToggleGroupDemo$output_text_derive = derive(
  ['state'],
  (state) => state.value || 'none',
);
