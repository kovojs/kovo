/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  navigationMenuContentAttributes,
  navigationMenuItemAttributes,
  navigationMenuLinkAttributes,
  navigationMenuListAttributes,
  navigationMenuRootAttributes,
  navigationMenuTriggerAttributes,
  navigationMenuViewportAttributes,
  type NavigationMenuItem,
} from '@jiso/headless-ui/primitives';

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
// generated artifacts prove the gallery path is compiled through Jiso.
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
        onKeyDown={() => {
          state.activeValue = 'docs';
          const doc = Reflect['get'](globalThis, 'document');
          const products = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-navigation-products-trigger')
            : undefined;
          const docs = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-navigation-docs-link')
            : undefined;
          if (products) products['tabIndex'] = -1;
          if (docs) docs['tabIndex'] = 0;
        }}
      >
        <div {...navigationMenuListAttributes(rootState)}>
          <div {...navigationMenuItemAttributes({ ...rootState, itemValue: 'products' })}>
            <button
              {...navigationMenuTriggerAttributes({
                ...rootState,
                contentId: 'gallery-navigation-products-content',
                id: 'gallery-navigation-products-trigger',
                itemLabel: 'Products',
                itemValue: 'products',
              })}
              onClick={() => {
                state.openValue = state.openValue === 'products' ? '' : 'products';
                const doc = Reflect['get'](globalThis, 'document');
                const trigger = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-navigation-products-trigger')
                  : undefined;
                const content = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-navigation-products-content')
                  : undefined;
                const viewport = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-navigation-viewport')
                  : undefined;
                const output = doc
                  ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="navigation-open"]')
                  : undefined;
                if (trigger)
                  Object(trigger)['setAttribute']?.call(
                    trigger,
                    'aria-expanded',
                    String(state.openValue === 'products'),
                  );
                if (content) content['hidden'] = state.openValue !== 'products';
                if (viewport) viewport['hidden'] = state.openValue === '';
                if (output) output['textContent'] = state.openValue || 'none';
              }}
            >
              Products
            </button>
          </div>
          <div {...navigationMenuItemAttributes({ ...rootState, itemValue: 'docs' })}>
            <a
              {...navigationMenuLinkAttributes({
                ...rootState,
                href: '/docs',
                id: 'gallery-navigation-docs-link',
                itemLabel: 'Docs',
                itemValue: 'docs',
              })}
              onClick={() => {
                state.openValue = '';
                state.value = 'docs';
                const doc = Reflect['get'](globalThis, 'document');
                const output = doc
                  ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="navigation-value"]')
                  : undefined;
                if (event) Object(event)['preventDefault']?.call(event);
                if (output) output['textContent'] = 'docs';
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
        >
          Platform primitives and gallery fixtures
        </div>
        <div
          {...navigationMenuViewportAttributes({ ...rootState, id: 'gallery-navigation-viewport' })}
        />
        <output data-demo-state="navigation-open">{state.openValue || 'none'}</output>
        <output data-demo-state="navigation-value">{state.value}</output>
      </section>
    );
  },
});
