/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  navigationMenuContentAttributes,
  navigationMenuFocusElement as _navigationMenuFocusElement,
  navigationMenuItemAttributes,
  navigationMenuKeyDown as _navigationMenuKeyDown,
  navigationMenuLinkAttributes,
  navigationMenuLinkClick as _navigationMenuLinkClick,
  navigationMenuListAttributes,
  navigationMenuMove as _navigationMenuMove,
  navigationMenuRootAttributes,
  navigationMenuTriggerAttributes,
  navigationMenuTriggerClick as _navigationMenuTriggerClick,
  navigationMenuTriggerFocus as _navigationMenuTriggerFocus,
  navigationMenuTriggerPointerEnter as _navigationMenuTriggerPointerEnter,
  navigationMenuTypeahead as _navigationMenuTypeahead,
  navigationMenuViewportAttributes,
  type NavigationMenuItem,
} from '@kovojs/headless-ui/primitives';

// Tailwind classes mirror the @kovojs/ui styled layer (packages/ui/src/navigation-menu.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const LIST_CLASS =
  'flex list-none items-center gap-1 rounded-md border border-neutral-200 bg-white p-1 shadow-sm data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch';
const ITEM_CLASS = 'relative data-[disabled]:opacity-50';
const TRIGGER_CLASS =
  'inline-flex h-9 items-center rounded px-3 text-sm font-medium text-neutral-700 outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-950 data-[state=open]:bg-neutral-100 data-[highlighted]:bg-neutral-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
const LINK_CLASS =
  'inline-flex h-9 items-center rounded px-3 text-sm font-medium text-neutral-700 outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-950 data-[highlighted]:bg-neutral-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
const CONTENT_CLASS =
  'mt-2 rounded-md border border-neutral-200 bg-white p-3 text-sm text-neutral-700 shadow-md outline-none data-[state=closed]:hidden';
const VIEWPORT_CLASS =
  'mt-2 rounded-md border border-neutral-200 bg-white shadow-md data-[state=closed]:hidden';

export interface GalleryNavigationMenuDemoState {
  activeValue: string;
  openValue: string;
  value: string;
}

const navigationItems: readonly NavigationMenuItem[] = Object.freeze([
  { hasContent: true, label: 'Products', value: 'products' },
  { label: 'Docs', value: 'docs' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryNavigationMenuDemo = component('gallery-navigation-menu-demo', {
  state: () => ({ activeValue: 'products', openValue: '', value: 'none' }),
  render: (_queries: Record<string, never>, state: GalleryNavigationMenuDemoState) => {
    const rootState = {
      activeValue: state.activeValue,
      items: navigationItems,
      label: 'Primary',
      ...(state.openValue === '' ? {} : { openValue: state.openValue }),
    };

    return (
      <section
        {...navigationMenuRootAttributes(rootState)}
        class="grid gap-2"
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
        <div {...navigationMenuListAttributes(rootState)} class={LIST_CLASS}>
          <div
            {...navigationMenuItemAttributes({ ...rootState, itemValue: 'products' })}
            class={ITEM_CLASS}
            data-highlighted={state.activeValue === 'products' ? '' : null}
            data-state={state.activeValue === 'products' ? 'active' : 'inactive'}
          >
            <button
              {...navigationMenuTriggerAttributes({
                ...rootState,
                contentId: 'gallery-navigation-products-content',
                id: 'gallery-navigation-products-trigger',
                itemLabel: 'Products',
                itemValue: 'products',
              })}
              aria-expanded={state.openValue === 'products' ? 'true' : 'false'}
              class={TRIGGER_CLASS}
              data-highlighted={state.activeValue === 'products' ? '' : null}
              data-state={state.openValue === 'products' ? 'open' : 'closed'}
              tabIndex={state.activeValue === 'products' ? 0 : -1}
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
            >
              Products
            </button>
          </div>
          <div
            {...navigationMenuItemAttributes({ ...rootState, itemValue: 'docs' })}
            class={ITEM_CLASS}
            data-highlighted={state.activeValue === 'docs' ? '' : null}
            data-state={state.activeValue === 'docs' ? 'active' : 'inactive'}
          >
            <a
              {...navigationMenuLinkAttributes({
                ...rootState,
                href: '/docs',
                id: 'gallery-navigation-docs-link',
                itemLabel: 'Docs',
                itemValue: 'docs',
              })}
              class={LINK_CLASS}
              data-highlighted={state.activeValue === 'docs' ? '' : null}
              data-state={state.activeValue === 'docs' ? 'active' : 'inactive'}
              tabIndex={state.activeValue === 'docs' ? 0 : -1}
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
            >
              Docs
            </a>
          </div>
        </div>
        <div
          {...navigationMenuContentAttributes({
            ...rootState,
            id: 'gallery-navigation-products-content',
            labelledBy: 'gallery-navigation-products-trigger',
            value: 'products',
          })}
          class={CONTENT_CLASS}
          data-state={state.openValue === 'products' ? 'open' : 'closed'}
          hidden={state.openValue !== 'products'}
        >
          Platform primitives and gallery fixtures
        </div>
        <div
          {...navigationMenuViewportAttributes({ ...rootState, id: 'gallery-navigation-viewport' })}
          class={VIEWPORT_CLASS}
          data-state={state.openValue === 'products' ? 'open' : 'closed'}
          hidden={state.openValue === ''}
        />
        <output data-demo-state="navigation-open">{state.openValue || 'none'}</output>
        <output data-demo-state="navigation-value">{state.value}</output>
      </section>
    );
  },
});
