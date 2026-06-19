// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  accordionKeyDown as _accordionKeyDown,
  accordionTriggerClick as _accordionTriggerClick,
} from '@kovojs/headless-ui/accordion';

export const GalleryAccordionDemo$Accordion_keydown = handler((event, ctx) => {
  const result = _accordionKeyDown(Object(event), {
    activeValue: ctx.state.activeValue,
    items: [{ value: 'shipping' }, { value: 'billing' }],
    type: 'single',
    value: ctx.state.value || undefined,
  });
  if (!result?.value) return;
  ctx.state.activeValue = result.value;
  const root = Object(event)['target']?.closest?.('[data-gallery-interactive="accordion"]');
  const next = Object(root)?.querySelector?.(`#gallery-accordion-${result.value}-trigger`);
  Object(next)['focus']?.call(next);
});
export const GalleryAccordionDemo$AccordionTrigger_click = handler((event, ctx) => {
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
export const GalleryAccordionDemo$AccordionTrigger_click_2 = handler((event, ctx) => {
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

export const GalleryAccordionDemo$AccordionItem_value_derive = derive(
  ['state'],
  (state) => state.value || undefined,
);
export const GalleryAccordionDemo$AccordionHeader_value_derive = derive(
  ['state'],
  (state) => state.value || undefined,
);
export const GalleryAccordionDemo$AccordionTrigger_tabIndex_derive = derive(['state'], (state) =>
  state.activeValue === 'shipping' ? 0 : -1,
);
export const GalleryAccordionDemo$AccordionTrigger_value_derive = derive(
  ['state'],
  (state) => state.value || undefined,
);
export const GalleryAccordionDemo$AccordionContent_value_derive = derive(
  ['state'],
  (state) => state.value || undefined,
);
export const GalleryAccordionDemo$AccordionItem_value_derive_2 = derive(
  ['state'],
  (state) => state.value || undefined,
);
export const GalleryAccordionDemo$AccordionHeader_value_derive_2 = derive(
  ['state'],
  (state) => state.value || undefined,
);
export const GalleryAccordionDemo$AccordionTrigger_tabIndex_derive_2 = derive(['state'], (state) =>
  state.activeValue === 'billing' ? 0 : -1,
);
export const GalleryAccordionDemo$AccordionTrigger_value_derive_2 = derive(
  ['state'],
  (state) => state.value || undefined,
);
export const GalleryAccordionDemo$AccordionContent_value_derive_2 = derive(
  ['state'],
  (state) => state.value || undefined,
);
export const GalleryAccordionDemo$AccordionItem_data_state_derive = derive(['state'], (state) =>
  (state.value || undefined) === 'shipping' ? 'open' : 'closed',
);
export const GalleryAccordionDemo$AccordionItem_open_derive = derive(['state'], (state) =>
  (state.value || undefined) === 'shipping' ? '' : null,
);
export const GalleryAccordionDemo$AccordionHeader_data_state_derive = derive(['state'], (state) =>
  (state.value || undefined) === 'shipping' ? 'open' : 'closed',
);
export const GalleryAccordionDemo$AccordionTrigger_aria_expanded_derive = derive(
  ['state'],
  (state) => ((state.value || undefined) === 'shipping' ? 'true' : 'false'),
);
export const GalleryAccordionDemo$AccordionTrigger_data_state_derive = derive(['state'], (state) =>
  (state.value || undefined) === 'shipping' ? 'open' : 'closed',
);
export const GalleryAccordionDemo$AccordionContent_data_state_derive = derive(['state'], (state) =>
  (state.value || undefined) === 'shipping' ? 'open' : 'closed',
);
export const GalleryAccordionDemo$AccordionContent_hidden_derive = derive(['state'], (state) =>
  (state.value || undefined) === 'shipping' ? null : '',
);
export const GalleryAccordionDemo$AccordionItem_data_state_derive_2 = derive(['state'], (state) =>
  (state.value || undefined) === 'billing' ? 'open' : 'closed',
);
export const GalleryAccordionDemo$AccordionItem_open_derive_2 = derive(['state'], (state) =>
  (state.value || undefined) === 'billing' ? '' : null,
);
export const GalleryAccordionDemo$AccordionHeader_data_state_derive_2 = derive(['state'], (state) =>
  (state.value || undefined) === 'billing' ? 'open' : 'closed',
);
export const GalleryAccordionDemo$AccordionTrigger_aria_expanded_derive_2 = derive(
  ['state'],
  (state) => ((state.value || undefined) === 'billing' ? 'true' : 'false'),
);
export const GalleryAccordionDemo$AccordionTrigger_data_state_derive_2 = derive(
  ['state'],
  (state) => ((state.value || undefined) === 'billing' ? 'open' : 'closed'),
);
export const GalleryAccordionDemo$AccordionContent_data_state_derive_2 = derive(
  ['state'],
  (state) => ((state.value || undefined) === 'billing' ? 'open' : 'closed'),
);
export const GalleryAccordionDemo$AccordionContent_hidden_derive_2 = derive(['state'], (state) =>
  (state.value || undefined) === 'billing' ? null : '',
);
export const GalleryAccordionDemo$output_text_derive = derive(
  ['state'],
  (state) => state.value || 'none',
);
