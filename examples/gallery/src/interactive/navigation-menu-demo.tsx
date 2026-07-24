/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  browserEventKey as _browserEventKey,
  browserEventPreventDefault as _browserEventPreventDefault,
  navigationMenuFocusElement as _navigationMenuFocusElement,
  navigationMenuKeyDown as _navigationMenuKeyDown,
  navigationMenuLinkClick as _navigationMenuLinkClick,
  navigationMenuMove as _navigationMenuMove,
  navigationMenuTriggerClick as _navigationMenuTriggerClick,
  navigationMenuTriggerFocus as _navigationMenuTriggerFocus,
  navigationMenuTriggerPointerEnter as _navigationMenuTriggerPointerEnter,
  navigationMenuTypeahead as _navigationMenuTypeahead,
  type NavigationMenuItem as GalleryNavigationMenuItem,
} from '../primitive-actions.js';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
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
      openValue: state.openValue || undefined,
    };

    return (
      <NavigationMenu
        {...rootState}
        data-gallery-interactive="navigation-menu"
        data-open={state.openValue || 'none'}
        onKeyDown={() => {
          const keyResult = _navigationMenuKeyDown(event! as never, {
            activeValue: state.activeValue,
            items: [
              { hasContent: true, label: 'Products', value: 'products' },
              { label: 'Docs', value: 'docs' },
            ],
            openValue: state.openValue || undefined,
          });
          if (keyResult?.changed) {
            state.openValue = keyResult.openValue ?? '';
            if (_browserEventKey(event! as never) === 'Escape') {
              _navigationMenuFocusElement(
                event! as never,
                state.activeValue === 'docs'
                  ? 'gallery-navigation-docs-link'
                  : 'gallery-navigation-products-trigger',
              );
            } else {
              state.activeValue = 'products';
              _navigationMenuFocusElement(event! as never, 'gallery-navigation-products-trigger');
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
              openValue: state.openValue || undefined,
            },
            _browserEventKey(event! as never),
            { loop: true },
          );
          if (move) {
            _browserEventPreventDefault(event! as never);
            state.activeValue = move.activeValue ?? state.activeValue;
            if (state.openValue !== '')
              state.openValue = state.activeValue === 'products' ? 'products' : '';
            _navigationMenuFocusElement(
              event! as never,
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
              openValue: state.openValue || undefined,
            },
            _browserEventKey(event! as never),
            { loop: true, now: 0 },
          );
          if (typeahead.activeValue === state.activeValue) return;
          _browserEventPreventDefault(event! as never);
          state.activeValue = typeahead.activeValue ?? state.activeValue;
          if (state.openValue !== '')
            state.openValue = state.activeValue === 'products' ? 'products' : '';
          _navigationMenuFocusElement(
            event! as never,
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
                const result = _navigationMenuTriggerClick(event! as never, {
                  activeValue: state.activeValue,
                  contentId: 'gallery-navigation-products-content',
                  itemValue: 'products',
                  items: [
                    { hasContent: true, label: 'Products', value: 'products' },
                    { label: 'Docs', value: 'docs' },
                  ],
                  openValue: state.openValue || undefined,
                });
                if (!result?.changed) return;
                state.activeValue = 'products';
                state.openValue = result.openValue ?? '';
              }}
              onFocus={() => {
                const result = _navigationMenuTriggerFocus(event! as never, {
                  activeValue: state.activeValue,
                  contentId: 'gallery-navigation-products-content',
                  itemValue: 'products',
                  items: [
                    { hasContent: true, label: 'Products', value: 'products' },
                    { label: 'Docs', value: 'docs' },
                  ],
                  openValue: state.openValue || undefined,
                });
                state.activeValue = 'products';
                if (result?.changed) state.openValue = result.openValue ?? '';
              }}
              onPointerEnter={() => {
                const result = _navigationMenuTriggerPointerEnter(event! as never, {
                  activeValue: state.activeValue,
                  contentId: 'gallery-navigation-products-content',
                  itemValue: 'products',
                  items: [
                    { hasContent: true, label: 'Products', value: 'products' },
                    { label: 'Docs', value: 'docs' },
                  ],
                  openValue: state.openValue || undefined,
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
                const result = _navigationMenuLinkClick(event! as never, {
                  activeValue: state.activeValue,
                  href: '/docs',
                  itemValue: 'docs',
                  items: [
                    { hasContent: true, label: 'Products', value: 'products' },
                    { label: 'Docs', value: 'docs' },
                  ],
                  openValue: state.openValue || undefined,
                });
                if (!result?.selected) return;
                _browserEventPreventDefault(event! as never);
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
          {/* shadcn-style content panel: link rows with a bold title over a muted
              description, instead of a single bare line. Kept to two rows so the
              open panel fits within the demo frame (which clips overflow). */}
          <ul style="display:grid;gap:0.125rem;width:22rem;margin:0;padding:0;list-style:none">
            <li>
              <a
                href="/docs"
                style="display:grid;gap:0.0625rem;border-radius:0.375rem;padding:0.4375rem 0.625rem;text-decoration:none"
              >
                <span style="font-weight:500;color:var(--ink,#171717)">Primitives</span>
                <span style="font-size:0.8125rem;line-height:1.3;color:var(--dim,#6b7280)">
                  Headless behaviors for any skin.
                </span>
              </a>
            </li>
            <li>
              <a
                href="/components"
                style="display:grid;gap:0.0625rem;border-radius:0.375rem;padding:0.4375rem 0.625rem;text-decoration:none"
              >
                <span style="font-weight:500;color:var(--ink,#171717)">Styled components</span>
                <span style="font-size:0.8125rem;line-height:1.3;color:var(--dim,#6b7280)">
                  shadcn-shaped UI on the primitives.
                </span>
              </a>
            </li>
          </ul>
        </NavigationMenuContent>
        <NavigationMenuViewport
          {...rootState}
          data-state={state.openValue === 'products' ? 'open' : 'closed'}
          hidden={state.openValue === ''}
          id="gallery-navigation-viewport"
        />
        <output
          data-demo-state="navigation-open"
          style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"
        >
          {state.openValue || 'none'}
        </output>
        <output
          data-demo-state="navigation-value"
          style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"
        >
          {state.value}
        </output>
      </NavigationMenu>
    );
  },
});
