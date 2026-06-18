// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  navigationMenuFocusElement as _navigationMenuFocusElement,
  navigationMenuKeyDown as _navigationMenuKeyDown,
  navigationMenuLinkClick as _navigationMenuLinkClick,
  navigationMenuMove as _navigationMenuMove,
  navigationMenuTriggerClick as _navigationMenuTriggerClick,
  navigationMenuTriggerFocus as _navigationMenuTriggerFocus,
  navigationMenuTriggerPointerEnter as _navigationMenuTriggerPointerEnter,
  navigationMenuTypeahead as _navigationMenuTypeahead,
} from '@kovojs/ui/navigation-menu';

export const GalleryNavigationMenuDemo$NavigationMenu_keydown = handler((event, ctx) => {
  const keyResult = _navigationMenuKeyDown(Object(event), {
    activeValue: ctx.state.activeValue,
    items: [
      { hasContent: true, label: 'Products', value: 'products' },
      { label: 'Docs', value: 'docs' },
    ],
    ...(ctx.state.openValue === '' ? {} : { openValue: ctx.state.openValue }),
  });
  if (keyResult?.changed) {
    ctx.state.openValue = keyResult.openValue ?? '';
    if (Object(event).key === 'Escape') {
      _navigationMenuFocusElement(
        Object(event),
        ctx.state.activeValue === 'docs'
          ? 'gallery-navigation-docs-link'
          : 'gallery-navigation-products-trigger',
      );
    } else {
      ctx.state.activeValue = 'products';
      _navigationMenuFocusElement(Object(event), 'gallery-navigation-products-trigger');
    }
    return;
  }

  const move = _navigationMenuMove(
    {
      activeValue: ctx.state.activeValue,
      items: [
        { hasContent: true, label: 'Products', value: 'products' },
        { label: 'Docs', value: 'docs' },
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
      ctx.state.openValue = ctx.state.activeValue === 'products' ? 'products' : '';
    _navigationMenuFocusElement(
      Object(event),
      ctx.state.activeValue === 'docs'
        ? 'gallery-navigation-docs-link'
        : 'gallery-navigation-products-trigger',
    );
    return;
  }

  const typeahead = _navigationMenuTypeahead(
    {
      activeValue: ctx.state.activeValue,
      items: [
        { hasContent: true, label: 'Products', value: 'products' },
        { label: 'Docs', value: 'docs' },
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
    ctx.state.openValue = ctx.state.activeValue === 'products' ? 'products' : '';
  _navigationMenuFocusElement(
    Object(event),
    ctx.state.activeValue === 'docs'
      ? 'gallery-navigation-docs-link'
      : 'gallery-navigation-products-trigger',
  );
});
export const GalleryNavigationMenuDemo$NavigationMenuTrigger_click = handler((event, ctx) => {
  const result = _navigationMenuTriggerClick(Object(event), {
    activeValue: ctx.state.activeValue,
    contentId: 'gallery-navigation-products-content',
    itemValue: 'products',
    items: [
      { hasContent: true, label: 'Products', value: 'products' },
      { label: 'Docs', value: 'docs' },
    ],
    ...(ctx.state.openValue === '' ? {} : { openValue: ctx.state.openValue }),
  });
  if (!result?.changed) return;
  ctx.state.activeValue = 'products';
  ctx.state.openValue = result.openValue ?? '';
});
export const GalleryNavigationMenuDemo$NavigationMenuTrigger_focus = handler((event, ctx) => {
  const result = _navigationMenuTriggerFocus(Object(event), {
    activeValue: ctx.state.activeValue,
    contentId: 'gallery-navigation-products-content',
    itemValue: 'products',
    items: [
      { hasContent: true, label: 'Products', value: 'products' },
      { label: 'Docs', value: 'docs' },
    ],
    ...(ctx.state.openValue === '' ? {} : { openValue: ctx.state.openValue }),
  });
  ctx.state.activeValue = 'products';
  if (result?.changed) ctx.state.openValue = result.openValue ?? '';
});
export const GalleryNavigationMenuDemo$NavigationMenuTrigger_pointerenter = handler(
  (event, ctx) => {
    const result = _navigationMenuTriggerPointerEnter(Object(event), {
      activeValue: ctx.state.activeValue,
      contentId: 'gallery-navigation-products-content',
      itemValue: 'products',
      items: [
        { hasContent: true, label: 'Products', value: 'products' },
        { label: 'Docs', value: 'docs' },
      ],
      ...(ctx.state.openValue === '' ? {} : { openValue: ctx.state.openValue }),
    });
    ctx.state.activeValue = 'products';
    if (result?.changed) ctx.state.openValue = result.openValue ?? '';
  },
);
export const GalleryNavigationMenuDemo$NavigationMenuLink_click = handler((event, ctx) => {
  const result = _navigationMenuLinkClick(Object(event), {
    activeValue: ctx.state.activeValue,
    href: '/docs',
    itemValue: 'docs',
    items: [
      { hasContent: true, label: 'Products', value: 'products' },
      { label: 'Docs', value: 'docs' },
    ],
    ...(ctx.state.openValue === '' ? {} : { openValue: ctx.state.openValue }),
  });
  if (!result?.selected) return;
  Object(event).preventDefault?.();
  ctx.state.activeValue = 'docs';
  ctx.state.openValue = result.open.openValue ?? '';
  ctx.state.value = result.value;
});
export const GalleryNavigationMenuDemo$NavigationMenuLink_focus = handler((_event, ctx) => {
  ctx.state.activeValue = 'docs';
  ctx.state.openValue = '';
});

export const GalleryNavigationMenuDemo$NavigationMenu_data_open_derive = derive(
  ['state'],
  (state) => state.openValue || 'none',
);
export const GalleryNavigationMenuDemo$NavigationMenuItem_data_highlighted_derive = derive(
  ['state'],
  (state) => (state.activeValue === 'products' ? '' : null),
);
export const GalleryNavigationMenuDemo$NavigationMenuItem_data_state_derive = derive(
  ['state'],
  (state) => (state.activeValue === 'products' ? 'active' : 'inactive'),
);
export const GalleryNavigationMenuDemo$NavigationMenuTrigger_aria_expanded_derive = derive(
  ['state'],
  (state) => (state.openValue === 'products' ? 'true' : 'false'),
);
export const GalleryNavigationMenuDemo$NavigationMenuTrigger_data_highlighted_derive = derive(
  ['state'],
  (state) => (state.activeValue === 'products' ? '' : null),
);
export const GalleryNavigationMenuDemo$NavigationMenuTrigger_data_state_derive = derive(
  ['state'],
  (state) => (state.openValue === 'products' ? 'open' : 'closed'),
);
export const GalleryNavigationMenuDemo$NavigationMenuTrigger_tabIndex_derive = derive(
  ['state'],
  (state) => (state.activeValue === 'products' ? 0 : -1),
);
export const GalleryNavigationMenuDemo$NavigationMenuItem_data_highlighted_derive_2 = derive(
  ['state'],
  (state) => (state.activeValue === 'docs' ? '' : null),
);
export const GalleryNavigationMenuDemo$NavigationMenuItem_data_state_derive_2 = derive(
  ['state'],
  (state) => (state.activeValue === 'docs' ? 'active' : 'inactive'),
);
export const GalleryNavigationMenuDemo$NavigationMenuLink_data_highlighted_derive = derive(
  ['state'],
  (state) => (state.activeValue === 'docs' ? '' : null),
);
export const GalleryNavigationMenuDemo$NavigationMenuLink_data_state_derive = derive(
  ['state'],
  (state) => (state.activeValue === 'docs' ? 'active' : 'inactive'),
);
export const GalleryNavigationMenuDemo$NavigationMenuLink_tabIndex_derive = derive(
  ['state'],
  (state) => (state.activeValue === 'docs' ? 0 : -1),
);
export const GalleryNavigationMenuDemo$NavigationMenuContent_data_state_derive = derive(
  ['state'],
  (state) => (state.openValue === 'products' ? 'open' : 'closed'),
);
export const GalleryNavigationMenuDemo$NavigationMenuContent_hidden_derive = derive(
  ['state'],
  (state) => (state.openValue !== 'products' ? '' : null),
);
export const GalleryNavigationMenuDemo$NavigationMenuViewport_data_state_derive = derive(
  ['state'],
  (state) => (state.openValue === 'products' ? 'open' : 'closed'),
);
export const GalleryNavigationMenuDemo$NavigationMenuViewport_hidden_derive = derive(
  ['state'],
  (state) => (state.openValue === '' ? '' : null),
);
export const GalleryNavigationMenuDemo$output_text_derive = derive(
  ['state'],
  (state) => state.openValue || 'none',
);
