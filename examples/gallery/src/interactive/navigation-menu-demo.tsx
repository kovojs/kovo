/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import type { NavigationMenuItem as GalleryNavigationMenuItem } from '@kovojs/headless-ui/navigation-menu';
import {
  NavigationMenu,
  NavigationMenuContent,
  navigationMenuFocusElement as _navigationMenuFocusElement,
  NavigationMenuItem,
  navigationMenuKeyDown as _navigationMenuKeyDown,
  NavigationMenuLink,
  navigationMenuLinkClick as _navigationMenuLinkClick,
  NavigationMenuList,
  navigationMenuMove as _navigationMenuMove,
  NavigationMenuTrigger,
  navigationMenuTriggerClick as _navigationMenuTriggerClick,
  navigationMenuTriggerFocus as _navigationMenuTriggerFocus,
  navigationMenuTriggerPointerEnter as _navigationMenuTriggerPointerEnter,
  navigationMenuTypeahead as _navigationMenuTypeahead,
  NavigationMenuViewport,
} from '@kovojs/ui/navigation-menu';

export interface GalleryNavigationMenuDemoState {
  activeValue: string;
  openValue: string;
  value: string;
}

const navigationItems: readonly GalleryNavigationMenuItem[] = Object.freeze([
  { hasContent: true, label: 'Products', value: 'products' },
  { label: 'Docs', value: 'docs' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryNavigationMenuDemo = component({
  state: () => ({ activeValue: 'products', openValue: '', value: 'none' }),
  render: (_queries: Record<string, never>, state: GalleryNavigationMenuDemoState) => {
    const rootState = {
      activeValue: state.activeValue,
      items: navigationItems,
      label: 'Primary',
      ...(state.openValue === '' ? {} : { openValue: state.openValue }),
    };

    return (
      <NavigationMenu
        {...rootState}
        data-gallery-interactive="navigation-menu"
        data-open={state.openValue || 'none'}
        onKeyDown={() => {
          const keyResult = _navigationMenuKeyDown(Object(event), {
            activeValue: state.activeValue,
            items: [
              { hasContent: true, label: 'Products', value: 'products' },
              { label: 'Docs', value: 'docs' },
            ],
            ...(state.openValue === '' ? {} : { openValue: state.openValue }),
          });
          if (keyResult?.changed) {
            state.openValue = keyResult.openValue ?? '';
            if (Object(event).key === 'Escape') {
              _navigationMenuFocusElement(
                Object(event),
                state.activeValue === 'docs'
                  ? 'gallery-navigation-docs-link'
                  : 'gallery-navigation-products-trigger',
              );
            } else {
              state.activeValue = 'products';
              _navigationMenuFocusElement(Object(event), 'gallery-navigation-products-trigger');
            }
            return;
          }

          const move = _navigationMenuMove(
            {
              activeValue: state.activeValue,
              items: [
                { hasContent: true, label: 'Products', value: 'products' },
                { label: 'Docs', value: 'docs' },
              ],
              ...(state.openValue === '' ? {} : { openValue: state.openValue }),
            },
            Object(event).key,
            { loop: true },
          );
          if (move) {
            Object(event).preventDefault?.();
            state.activeValue = move.activeValue ?? state.activeValue;
            if (state.openValue !== '')
              state.openValue = state.activeValue === 'products' ? 'products' : '';
            _navigationMenuFocusElement(
              Object(event),
              state.activeValue === 'docs'
                ? 'gallery-navigation-docs-link'
                : 'gallery-navigation-products-trigger',
            );
            return;
          }

          const typeahead = _navigationMenuTypeahead(
            {
              activeValue: state.activeValue,
              items: [
                { hasContent: true, label: 'Products', value: 'products' },
                { label: 'Docs', value: 'docs' },
              ],
              ...(state.openValue === '' ? {} : { openValue: state.openValue }),
            },
            Object(event).key,
            { loop: true, now: 0 },
          );
          if (typeahead.activeValue === state.activeValue) return;
          Object(event).preventDefault?.();
          state.activeValue = typeahead.activeValue ?? state.activeValue;
          if (state.openValue !== '')
            state.openValue = state.activeValue === 'products' ? 'products' : '';
          _navigationMenuFocusElement(
            Object(event),
            state.activeValue === 'docs'
              ? 'gallery-navigation-docs-link'
              : 'gallery-navigation-products-trigger',
          );
        }}
      >
        <NavigationMenuList {...rootState}>
          <NavigationMenuItem
            {...rootState}
            data-highlighted={state.activeValue === 'products' ? '' : null}
            data-state={state.activeValue === 'products' ? 'active' : 'inactive'}
            itemValue="products"
          >
            <NavigationMenuTrigger
              {...rootState}
              aria-expanded={state.openValue === 'products' ? 'true' : 'false'}
              contentId="gallery-navigation-products-content"
              data-highlighted={state.activeValue === 'products' ? '' : null}
              data-state={state.openValue === 'products' ? 'open' : 'closed'}
              id="gallery-navigation-products-trigger"
              itemLabel="Products"
              itemValue="products"
              onClick={() => {
                const result = _navigationMenuTriggerClick(Object(event), {
                  activeValue: state.activeValue,
                  contentId: 'gallery-navigation-products-content',
                  itemValue: 'products',
                  items: [
                    { hasContent: true, label: 'Products', value: 'products' },
                    { label: 'Docs', value: 'docs' },
                  ],
                  ...(state.openValue === '' ? {} : { openValue: state.openValue }),
                });
                if (!result?.changed) return;
                state.activeValue = 'products';
                state.openValue = result.openValue ?? '';
              }}
              onFocus={() => {
                const result = _navigationMenuTriggerFocus(Object(event), {
                  activeValue: state.activeValue,
                  contentId: 'gallery-navigation-products-content',
                  itemValue: 'products',
                  items: [
                    { hasContent: true, label: 'Products', value: 'products' },
                    { label: 'Docs', value: 'docs' },
                  ],
                  ...(state.openValue === '' ? {} : { openValue: state.openValue }),
                });
                state.activeValue = 'products';
                if (result?.changed) state.openValue = result.openValue ?? '';
              }}
              onPointerEnter={() => {
                const result = _navigationMenuTriggerPointerEnter(Object(event), {
                  activeValue: state.activeValue,
                  contentId: 'gallery-navigation-products-content',
                  itemValue: 'products',
                  items: [
                    { hasContent: true, label: 'Products', value: 'products' },
                    { label: 'Docs', value: 'docs' },
                  ],
                  ...(state.openValue === '' ? {} : { openValue: state.openValue }),
                });
                state.activeValue = 'products';
                if (result?.changed) state.openValue = result.openValue ?? '';
              }}
              tabIndex={state.activeValue === 'products' ? 0 : -1}
            >
              Products
            </NavigationMenuTrigger>
          </NavigationMenuItem>
          <NavigationMenuItem
            {...rootState}
            data-highlighted={state.activeValue === 'docs' ? '' : null}
            data-state={state.activeValue === 'docs' ? 'active' : 'inactive'}
            itemValue="docs"
          >
            <NavigationMenuLink
              {...rootState}
              data-highlighted={state.activeValue === 'docs' ? '' : null}
              data-state={state.activeValue === 'docs' ? 'active' : 'inactive'}
              href="/docs"
              id="gallery-navigation-docs-link"
              itemLabel="Docs"
              itemValue="docs"
              onClick={() => {
                const result = _navigationMenuLinkClick(Object(event), {
                  activeValue: state.activeValue,
                  href: '/docs',
                  itemValue: 'docs',
                  items: [
                    { hasContent: true, label: 'Products', value: 'products' },
                    { label: 'Docs', value: 'docs' },
                  ],
                  ...(state.openValue === '' ? {} : { openValue: state.openValue }),
                });
                if (!result?.selected) return;
                Object(event).preventDefault?.();
                state.activeValue = 'docs';
                state.openValue = result.open.openValue ?? '';
                state.value = result.value;
              }}
              onFocus={() => {
                state.activeValue = 'docs';
                state.openValue = '';
              }}
              tabIndex={state.activeValue === 'docs' ? 0 : -1}
            >
              Docs
            </NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
        <NavigationMenuContent
          {...rootState}
          data-state={state.openValue === 'products' ? 'open' : 'closed'}
          hidden={state.openValue !== 'products'}
          id="gallery-navigation-products-content"
          labelledBy="gallery-navigation-products-trigger"
          value="products"
        >
          Platform primitives and gallery fixtures
        </NavigationMenuContent>
        <NavigationMenuViewport
          {...rootState}
          data-state={state.openValue === 'products' ? 'open' : 'closed'}
          hidden={state.openValue === ''}
          id="gallery-navigation-viewport"
        />
        <output data-demo-state="navigation-open">{state.openValue || 'none'}</output>
        <output data-demo-state="navigation-value">{state.value}</output>
      </NavigationMenu>
    );
  },
});
