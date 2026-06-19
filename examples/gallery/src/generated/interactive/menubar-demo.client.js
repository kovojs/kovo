// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  menubarFocusElement as _menubarFocusElement,
  menubarItemClick as _menubarItemClick,
  menubarItemKeyDown as _menubarItemKeyDown,
  menubarKeyDown as _menubarKeyDown,
  menubarMove as _menubarMove,
  menubarSubmenuTriggerClick as _menubarSubmenuTriggerClick,
  menubarTypeahead as _menubarTypeahead,
} from '@kovojs/headless-ui/menubar';

export const GalleryMenubarDemo$section_keydown = handler((event, ctx) => {
  const keyResult = _menubarKeyDown(Object(event), {
    activeValue: ctx.state.activeValue,
    items: [
      { hasPopup: true, label: 'File', value: 'file' },
      { label: 'Edit', value: 'edit' },
      { label: 'New file', parentValue: 'file', value: 'new' },
      { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
    ],
    ...(ctx.state.openValue === '' ? {} : { openValue: ctx.state.openValue }),
  });
  if (keyResult?.changed) {
    ctx.state.openValue = keyResult.openValue ?? '';
    if (Object(event).key === 'Escape') {
      ctx.state.activeValue = 'file';
      _menubarFocusElement(Object(event), 'gallery-menubar-file');
    } else if (ctx.state.activeValue === 'file') {
      ctx.state.activeValue = 'new';
      _menubarFocusElement(Object(event), 'gallery-menubar-new', { defer: true });
    }
    return;
  }

  const move = _menubarMove(
    {
      activeValue: ctx.state.activeValue,
      items: [
        { hasPopup: true, label: 'File', value: 'file' },
        { label: 'Edit', value: 'edit' },
        { label: 'New file', parentValue: 'file', value: 'new' },
        { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
      ],
      ...(ctx.state.openValue === '' ? {} : { openValue: ctx.state.openValue }),
    },
    Object(event).key,
    { loop: true },
  );
  if (move) {
    Object(event).preventDefault?.();
    ctx.state.activeValue = move.activeValue ?? ctx.state.activeValue;
    if (ctx.state.openValue !== '')
      ctx.state.openValue = ctx.state.activeValue === 'file' ? 'file' : '';
    _menubarFocusElement(
      Object(event),
      ctx.state.activeValue === 'edit' ? 'gallery-menubar-edit' : 'gallery-menubar-file',
    );
    return;
  }

  const typeahead = _menubarTypeahead(
    {
      activeValue: ctx.state.activeValue,
      items: [
        { hasPopup: true, label: 'File', value: 'file' },
        { label: 'Edit', value: 'edit' },
        { label: 'New file', parentValue: 'file', value: 'new' },
        { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
      ],
      ...(ctx.state.openValue === '' ? {} : { openValue: ctx.state.openValue }),
    },
    Object(event).key,
    { loop: true, now: 0 },
  );
  if (typeahead.activeValue === ctx.state.activeValue) return;
  Object(event).preventDefault?.();
  ctx.state.activeValue = typeahead.activeValue ?? ctx.state.activeValue;
  if (ctx.state.openValue !== '')
    ctx.state.openValue = ctx.state.activeValue === 'file' ? 'file' : '';
  _menubarFocusElement(
    Object(event),
    ctx.state.activeValue === 'edit' ? 'gallery-menubar-edit' : 'gallery-menubar-file',
  );
});
export const GalleryMenubarDemo$MenubarItem_click = handler((event, ctx) => {
  const result = _menubarSubmenuTriggerClick(Object(event), {
    activeValue: ctx.state.activeValue,
    contentId: 'gallery-menubar-file-menu',
    itemValue: 'file',
    items: [
      { hasPopup: true, label: 'File', value: 'file' },
      { label: 'Edit', value: 'edit' },
      { label: 'New file', parentValue: 'file', value: 'new' },
      { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
    ],
    ...(ctx.state.openValue === '' ? {} : { openValue: ctx.state.openValue }),
  });
  if (!result?.changed) return;
  ctx.state.openValue = result.openValue ?? '';
  ctx.state.activeValue = result.openValue === 'file' ? 'new' : 'file';
  if (result.openValue === 'file')
    _menubarFocusElement(Object(event), 'gallery-menubar-new', { defer: true });
});
export const GalleryMenubarDemo$MenubarItem_keydown = handler((event, ctx) => {
  if (
    Object(event).key !== 'Enter' &&
    Object(event).key !== ' ' &&
    Object(event).key !== 'Spacebar'
  )
    return;

  const result = _menubarSubmenuTriggerClick(Object(event), {
    activeValue: ctx.state.activeValue,
    contentId: 'gallery-menubar-file-menu',
    itemValue: 'file',
    items: [
      { hasPopup: true, label: 'File', value: 'file' },
      { label: 'Edit', value: 'edit' },
      { label: 'New file', parentValue: 'file', value: 'new' },
      { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
    ],
    ...(ctx.state.openValue === '' ? {} : { openValue: ctx.state.openValue }),
  });
  if (!result?.changed) return;
  Object(event).preventDefault?.();
  ctx.state.openValue = result.openValue ?? '';
  ctx.state.activeValue = result.openValue === 'file' ? 'new' : 'file';
  if (result.openValue === 'file')
    _menubarFocusElement(Object(event), 'gallery-menubar-new', { defer: true });
});
export const GalleryMenubarDemo$MenubarItem_click_2 = handler((_event, ctx) => {
  ctx.state.activeValue = 'edit';
  ctx.state.openValue = '';
});
export const GalleryMenubarDemo$MenubarItem_keydown_2 = handler((event, ctx) => {
  const result = _menubarItemKeyDown(Object(event), {
    activeValue: ctx.state.activeValue,
    itemParentValue: 'file',
    itemValue: 'new',
    items: [
      { hasPopup: true, label: 'File', value: 'file' },
      { label: 'Edit', value: 'edit' },
      { label: 'New file', parentValue: 'file', value: 'new' },
      { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
    ],
    ...(ctx.state.openValue === '' ? {} : { openValue: ctx.state.openValue }),
  });
  if (result?.selected) {
    ctx.state.openValue = result.open.openValue ?? '';
    ctx.state.activeValue = 'file';
    ctx.state.value = result.value;
    _menubarFocusElement(Object(event), 'gallery-menubar-file');
    return;
  }

  const keyResult = _menubarKeyDown(Object(event), {
    activeValue: ctx.state.activeValue,
    items: [
      { hasPopup: true, label: 'File', value: 'file' },
      { label: 'Edit', value: 'edit' },
      { label: 'New file', parentValue: 'file', value: 'new' },
      { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
    ],
    ...(ctx.state.openValue === '' ? {} : { openValue: ctx.state.openValue }),
  });
  if (keyResult?.changed) {
    ctx.state.openValue = keyResult.openValue ?? '';
    ctx.state.activeValue = 'file';
    _menubarFocusElement(Object(event), 'gallery-menubar-file');
    return;
  }

  const move = _menubarMove(
    {
      activeValue: ctx.state.activeValue,
      items: [
        { hasPopup: true, label: 'File', value: 'file' },
        { label: 'Edit', value: 'edit' },
        { label: 'New file', parentValue: 'file', value: 'new' },
        { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
      ],
      ...(ctx.state.openValue === '' ? {} : { openValue: ctx.state.openValue }),
    },
    Object(event).key,
    { loop: true, parentValue: 'file' },
  );
  if (move) {
    Object(event).preventDefault?.();
    ctx.state.activeValue = move.activeValue ?? ctx.state.activeValue;
    _menubarFocusElement(Object(event), 'gallery-menubar-new');
    return;
  }

  const typeahead = _menubarTypeahead(
    {
      activeValue: ctx.state.activeValue,
      items: [
        { hasPopup: true, label: 'File', value: 'file' },
        { label: 'Edit', value: 'edit' },
        { label: 'New file', parentValue: 'file', value: 'new' },
        { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
      ],
      ...(ctx.state.openValue === '' ? {} : { openValue: ctx.state.openValue }),
    },
    Object(event).key,
    { loop: true, now: 0, parentValue: 'file' },
  );
  if (typeahead.activeValue === ctx.state.activeValue) return;
  Object(event).preventDefault?.();
  ctx.state.activeValue = typeahead.activeValue ?? ctx.state.activeValue;
  _menubarFocusElement(Object(event), 'gallery-menubar-new');
});
export const GalleryMenubarDemo$MenubarItem_click_3 = handler((event, ctx) => {
  const result = _menubarItemClick(Object(event), {
    activeValue: ctx.state.activeValue,
    itemParentValue: 'file',
    itemValue: 'new',
    items: [
      { hasPopup: true, label: 'File', value: 'file' },
      { label: 'Edit', value: 'edit' },
      { label: 'New file', parentValue: 'file', value: 'new' },
      { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
    ],
    ...(ctx.state.openValue === '' ? {} : { openValue: ctx.state.openValue }),
  });
  if (!result?.selected) return;
  ctx.state.openValue = result.open.openValue ?? '';
  ctx.state.activeValue = 'file';
  ctx.state.value = result.value;
  _menubarFocusElement(Object(event), 'gallery-menubar-file');
});

export const GalleryMenubarDemo$section_data_open_derive = derive(
  ['state'],
  (state) => state.openValue || 'none',
);
export const GalleryMenubarDemo$MenubarItem_aria_expanded_derive = derive(['state'], (state) =>
  state.openValue === 'file' ? 'true' : 'false',
);
export const GalleryMenubarDemo$MenubarItem_data_highlighted_derive = derive(['state'], (state) =>
  state.activeValue === 'file' ? '' : null,
);
export const GalleryMenubarDemo$MenubarItem_data_state_derive = derive(['state'], (state) =>
  state.activeValue === 'file' ? 'active' : 'inactive',
);
export const GalleryMenubarDemo$MenubarItem_tabIndex_derive = derive(['state'], (state) =>
  state.activeValue === 'file' ? 0 : -1,
);
export const GalleryMenubarDemo$MenubarItem_data_highlighted_derive_2 = derive(['state'], (state) =>
  state.activeValue === 'edit' ? '' : null,
);
export const GalleryMenubarDemo$MenubarItem_data_state_derive_2 = derive(['state'], (state) =>
  state.activeValue === 'edit' ? 'active' : 'inactive',
);
export const GalleryMenubarDemo$MenubarItem_tabIndex_derive_2 = derive(['state'], (state) =>
  state.activeValue === 'edit' ? 0 : -1,
);
export const GalleryMenubarDemo$MenubarSubmenu_data_state_derive = derive(['state'], (state) =>
  state.openValue === 'file' ? 'open' : 'closed',
);
export const GalleryMenubarDemo$MenubarSubmenu_hidden_derive = derive(['state'], (state) =>
  state.openValue !== 'file' ? '' : null,
);
export const GalleryMenubarDemo$MenubarItem_data_highlighted_derive_3 = derive(['state'], (state) =>
  state.activeValue === 'new' ? '' : null,
);
export const GalleryMenubarDemo$MenubarItem_data_state_derive_3 = derive(['state'], (state) =>
  state.activeValue === 'new' ? 'active' : 'inactive',
);
export const GalleryMenubarDemo$MenubarItem_tabIndex_derive_3 = derive(['state'], (state) =>
  state.activeValue === 'new' ? 0 : -1,
);
export const GalleryMenubarDemo$output_text_derive = derive(
  ['state'],
  (state) => state.openValue || 'none',
);
