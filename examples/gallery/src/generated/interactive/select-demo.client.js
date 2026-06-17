// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  selectItemClick as _selectItemClick,
  selectKeyDown as _selectKeyDown,
  selectMove as _selectMove,
  selectTriggerClick as _selectTriggerClick,
} from '@kovojs/headless-ui/primitives';

export const GallerySelectDemo$button_click = handler((event, ctx) => {
  const result = _selectTriggerClick(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    items: [
      { label: 'Standard', value: 'standard' },
      { label: 'Express', value: 'express' },
      { disabled: true, label: 'Drone', value: 'drone' },
    ],
    open: ctx.state.open,
    value: ctx.state.value,
  });
  if (!result?.changed) return;
  ctx.state.open = result.open;
  ctx.state.highlightedValue = ctx.state.value;
});
export const GallerySelectDemo$button_keydown = handler((event, ctx) => {
  const keyResult = _selectKeyDown(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    items: [
      { label: 'Standard', value: 'standard' },
      { label: 'Express', value: 'express' },
      { disabled: true, label: 'Drone', value: 'drone' },
    ],
    open: ctx.state.open,
    value: ctx.state.value,
  });
  if (!keyResult) return;
  if ('open' in keyResult && typeof keyResult.open === 'object') {
    ctx.state.value = keyResult.value.value ?? ctx.state.value;
    ctx.state.highlightedValue = keyResult.value.value ?? ctx.state.highlightedValue;
    ctx.state.open = keyResult.open.open;
    return;
  }
  if ('open' in keyResult) {
    ctx.state.open = keyResult.open;
    if (keyResult.open) ctx.state.highlightedValue = ctx.state.value;
    return;
  }
  if ('highlightedValue' in keyResult) {
    ctx.state.highlightedValue = keyResult.highlightedValue ?? ctx.state.highlightedValue;
    return;
  }
  if ('matchIndex' in keyResult) {
    ctx.state.highlightedValue = keyResult.value ?? ctx.state.highlightedValue;
    return;
  }
});
export const GallerySelectDemo$div_keydown = handler((event, ctx) => {
  const move = _selectMove(
    {
      highlightedValue: ctx.state.highlightedValue,
      items: [
        { label: 'Standard', value: 'standard' },
        { label: 'Express', value: 'express' },
        { disabled: true, label: 'Drone', value: 'drone' },
      ],
      open: ctx.state.open,
      value: ctx.state.value,
    },
    Object(event).key,
    { loop: true },
  );
  if (!move) return;
  ctx.state.highlightedValue = move.highlightedValue ?? ctx.state.highlightedValue;
});
export const GallerySelectDemo$div_click = handler((event, ctx) => {
  const result = _selectItemClick(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    items: [
      { label: 'Standard', value: 'standard' },
      { label: 'Express', value: 'express' },
      { disabled: true, label: 'Drone', value: 'drone' },
    ],
    open: ctx.state.open,
    itemValue: 'standard',
    value: ctx.state.value,
  });
  if (!result?.value.changed) return;
  ctx.state.value = result.value.value ?? ctx.state.value;
  ctx.state.highlightedValue = result.value.value ?? ctx.state.highlightedValue;
  ctx.state.open = result.open.open;
});
export const GallerySelectDemo$div_click_2 = handler((event, ctx) => {
  const result = _selectItemClick(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    items: [
      { label: 'Standard', value: 'standard' },
      { label: 'Express', value: 'express' },
      { disabled: true, label: 'Drone', value: 'drone' },
    ],
    open: ctx.state.open,
    itemValue: 'express',
    value: ctx.state.value,
  });
  if (!result?.value.changed) return;
  ctx.state.value = result.value.value ?? ctx.state.value;
  ctx.state.highlightedValue = result.value.value ?? ctx.state.highlightedValue;
  ctx.state.open = result.open.open;
});
export const GallerySelectDemo$div_click_3 = handler((event, ctx) => {
  const result = _selectItemClick(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    items: [
      { label: 'Standard', value: 'standard' },
      { label: 'Express', value: 'express' },
      { disabled: true, label: 'Drone', value: 'drone' },
    ],
    open: ctx.state.open,
    itemDisabled: true,
    itemValue: 'drone',
    value: ctx.state.value,
  });
  if (!result?.value.changed) return;
  ctx.state.value = result.value.value ?? ctx.state.value;
  ctx.state.highlightedValue = result.value.value ?? ctx.state.highlightedValue;
  ctx.state.open = result.open.open;
});

export const GallerySelectDemo$input_value_derive = derive(['state'], (state) => state.value);
export const GallerySelectDemo$button_aria_expanded_derive = derive(['state'], (state) =>
  String(state.open),
);
export const GallerySelectDemo$button_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GallerySelectDemo$div_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GallerySelectDemo$div_hidden_derive = derive(['state'], (state) =>
  !state.open ? '' : null,
);
export const GallerySelectDemo$div_aria_selected_derive = derive(['state'], (state) =>
  state.value === 'standard' ? 'true' : 'false',
);
export const GallerySelectDemo$div_data_highlighted_derive = derive(['state'], (state) =>
  state.highlightedValue === 'standard' ? '' : null,
);
export const GallerySelectDemo$div_data_state_derive_2 = derive(['state'], (state) =>
  state.value === 'standard' ? 'checked' : 'unchecked',
);
export const GallerySelectDemo$div_aria_selected_derive_2 = derive(['state'], (state) =>
  state.value === 'express' ? 'true' : 'false',
);
export const GallerySelectDemo$div_data_highlighted_derive_2 = derive(['state'], (state) =>
  state.highlightedValue === 'express' ? '' : null,
);
export const GallerySelectDemo$div_data_state_derive_3 = derive(['state'], (state) =>
  state.value === 'express' ? 'checked' : 'unchecked',
);
export const GallerySelectDemo$div_aria_selected_derive_3 = derive(['state'], (state) =>
  state.value === 'drone' ? 'true' : 'false',
);
export const GallerySelectDemo$div_data_highlighted_derive_3 = derive(['state'], (state) =>
  state.highlightedValue === 'drone' ? '' : null,
);
export const GallerySelectDemo$div_data_state_derive_4 = derive(['state'], (state) =>
  state.value === 'drone' ? 'checked' : 'unchecked',
);
export const GallerySelectDemo$span_text_derive = derive(['state'], (state) =>
  state.value === 'express' ? 'Express' : 'Standard',
);
export const GallerySelectDemo$output_text_derive = derive(['state'], (state) =>
  state.value === 'express' ? 'Express' : 'Standard',
);
