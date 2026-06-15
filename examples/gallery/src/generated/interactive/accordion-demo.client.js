// @jiso-ir
import { derive, handler } from '@jiso/runtime';

import {
  accordionKeyDown as _accordionKeyDown,
  accordionTriggerClick as _accordionTriggerClick,
} from '@jiso/headless-ui/primitives';

export const GalleryAccordionDemo$section_keydown = handler((event, ctx) => {
  const result = _accordionKeyDown(Object(event), {
    activeValue: ctx.state.activeValue,
    items: [{ value: 'shipping' }, { value: 'billing' }],
    type: 'single',
    value: ctx.state.value || undefined,
  });
  if (!result?.value) return;
  ctx.state.activeValue = result.value;
  const root = Object(event)['target']?.closest?.('[data-gallery-interactive="accordion"]');
  const next = Object(root)?.querySelector?.(`[value="${result.value}"]`);
  Object(next)['focus']?.call(next);
});
export const GalleryAccordionDemo$button_click = handler((event, ctx) => {
  const result = _accordionTriggerClick(Object(event), {
    collapsible: true,
    itemValue: 'shipping',
    type: 'single',
    value: ctx.state.value || undefined,
  });
  if (!result) return;
  ctx.state.activeValue = 'shipping';
  ctx.state.value = result.value?.toString() ?? '';
});
export const GalleryAccordionDemo$button_click_2 = handler((event, ctx) => {
  const result = _accordionTriggerClick(Object(event), {
    collapsible: true,
    itemValue: 'billing',
    type: 'single',
    value: ctx.state.value || undefined,
  });
  if (!result) return;
  ctx.state.activeValue = 'billing';
  ctx.state.value = result.value?.toString() ?? '';
});

export const GalleryAccordionDemo$section_data_state_derive = derive(['state'], (state) =>
  state.value === 'shipping' ? 'open' : 'closed',
);
export const GalleryAccordionDemo$button_aria_expanded_derive = derive(['state'], (state) =>
  String(state.value === 'shipping'),
);
export const GalleryAccordionDemo$button_data_state_derive = derive(['state'], (state) =>
  state.value === 'shipping' ? 'open' : 'closed',
);
export const GalleryAccordionDemo$button_tabIndex_derive = derive(['state'], (state) =>
  state.activeValue === 'shipping' ? 0 : -1,
);
export const GalleryAccordionDemo$div_data_state_derive = derive(['state'], (state) =>
  state.value === 'shipping' ? 'open' : 'closed',
);
export const GalleryAccordionDemo$div_hidden_derive = derive(['state'], (state) =>
  state.value !== 'shipping' ? '' : null,
);
export const GalleryAccordionDemo$section_data_state_derive_2 = derive(['state'], (state) =>
  state.value === 'billing' ? 'open' : 'closed',
);
export const GalleryAccordionDemo$button_aria_expanded_derive_2 = derive(['state'], (state) =>
  String(state.value === 'billing'),
);
export const GalleryAccordionDemo$button_data_state_derive_2 = derive(['state'], (state) =>
  state.value === 'billing' ? 'open' : 'closed',
);
export const GalleryAccordionDemo$button_tabIndex_derive_2 = derive(['state'], (state) =>
  state.activeValue === 'billing' ? 0 : -1,
);
export const GalleryAccordionDemo$div_data_state_derive_2 = derive(['state'], (state) =>
  state.value === 'billing' ? 'open' : 'closed',
);
export const GalleryAccordionDemo$div_hidden_derive_2 = derive(['state'], (state) =>
  state.value !== 'billing' ? '' : null,
);
export const GalleryAccordionDemo$output_text_derive = derive(
  ['state'],
  (state) => state.value || 'none',
);
