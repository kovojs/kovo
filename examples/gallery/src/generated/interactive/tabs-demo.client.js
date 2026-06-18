// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  tabsKeyDown as _tabsKeyDown,
  tabsTriggerClick as _tabsTriggerClick,
} from '@kovojs/ui/tabs';

export const GalleryTabsDemo$Tabs_keydown = handler((event, ctx) => {
  const result = _tabsKeyDown(Object(event), {
    activationMode: 'manual',
    activeValue: ctx.state.activeValue,
    items: [{ value: 'overview' }, { disabled: true, value: 'audit' }, { value: 'details' }],
    value: ctx.state.value,
  });
  if (!result) return;
  ctx.state.activeValue = result.activeValue ?? ctx.state.activeValue;
  ctx.state.value = result.value ?? ctx.state.value;
});
export const GalleryTabsDemo$TabsTrigger_click = handler((event, ctx) => {
  const result = _tabsTriggerClick(Object(event), {
    itemValue: 'overview',
    value: ctx.state.value,
  });
  if (!result) return;
  ctx.state.activeValue = result.value ?? ctx.state.activeValue;
  ctx.state.value = result.value ?? ctx.state.value;
});
export const GalleryTabsDemo$TabsTrigger_click_2 = handler((event, ctx) => {
  const result = _tabsTriggerClick(Object(event), {
    itemValue: 'details',
    value: ctx.state.value,
  });
  if (!result) return;
  ctx.state.activeValue = result.value ?? ctx.state.activeValue;
  ctx.state.value = result.value ?? ctx.state.value;
});

export const GalleryTabsDemo$TabsTrigger_aria_selected_derive = derive(['state'], (state) =>
  String(state.value === 'overview'),
);
export const GalleryTabsDemo$TabsTrigger_data_state_derive = derive(['state'], (state) =>
  state.value === 'overview' ? 'active' : 'inactive',
);
export const GalleryTabsDemo$TabsTrigger_tabIndex_derive = derive(['state'], (state) =>
  state.activeValue === 'overview' ? 0 : -1,
);
export const GalleryTabsDemo$TabsTrigger_aria_selected_derive_2 = derive(['state'], (state) =>
  String(state.value === 'details'),
);
export const GalleryTabsDemo$TabsTrigger_data_state_derive_2 = derive(['state'], (state) =>
  state.value === 'details' ? 'active' : 'inactive',
);
export const GalleryTabsDemo$TabsTrigger_tabIndex_derive_2 = derive(['state'], (state) =>
  state.activeValue === 'details' ? 0 : -1,
);
export const GalleryTabsDemo$TabsTrigger_aria_selected_derive_3 = derive(['state'], (state) =>
  String(state.value === 'audit'),
);
export const GalleryTabsDemo$TabsTrigger_data_state_derive_3 = derive(['state'], (state) =>
  state.value === 'audit' ? 'active' : 'inactive',
);
export const GalleryTabsDemo$TabsPanel_data_state_derive = derive(['state'], (state) =>
  state.value === 'overview' ? 'active' : 'inactive',
);
export const GalleryTabsDemo$TabsPanel_hidden_derive = derive(['state'], (state) =>
  state.value !== 'overview' ? '' : null,
);
export const GalleryTabsDemo$TabsPanel_tabIndex_derive = derive(['state'], (state) =>
  state.value === 'overview' ? 0 : undefined,
);
export const GalleryTabsDemo$TabsPanel_data_state_derive_2 = derive(['state'], (state) =>
  state.value === 'details' ? 'active' : 'inactive',
);
export const GalleryTabsDemo$TabsPanel_hidden_derive_2 = derive(['state'], (state) =>
  state.value !== 'details' ? '' : null,
);
export const GalleryTabsDemo$TabsPanel_tabIndex_derive_2 = derive(['state'], (state) =>
  state.value === 'details' ? 0 : undefined,
);
export const GalleryTabsDemo$TabsPanel_data_state_derive_3 = derive(['state'], (state) =>
  state.value === 'audit' ? 'active' : 'inactive',
);
export const GalleryTabsDemo$TabsPanel_hidden_derive_3 = derive(['state'], (state) =>
  state.value !== 'audit' ? '' : null,
);
export const GalleryTabsDemo$TabsPanel_tabIndex_derive_3 = derive(['state'], (state) =>
  state.value === 'audit' ? 0 : undefined,
);
