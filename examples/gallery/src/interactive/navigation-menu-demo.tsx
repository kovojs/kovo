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

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/navigation-menu.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
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
          const key = String(Object(event)['key'] ?? '');
          const doc = Reflect['get'](globalThis, 'document');
          const products = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-navigation-products-trigger')
            : undefined;
          const docs = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-navigation-docs-link')
            : undefined;
          const content = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-navigation-products-content')
            : undefined;
          const viewport = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-navigation-viewport')
            : undefined;
          const openOutput = doc
            ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="navigation-open"]')
            : undefined;
          const valueOutput = doc
            ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="navigation-value"]')
            : undefined;

          if (key === 'ArrowRight') {
            state.activeValue = 'docs';
            if (products) products['tabIndex'] = -1;
            if (docs) docs['tabIndex'] = 0;
            return;
          }

          if (
            (key === 'Enter' || key === ' ' || key === 'Spacebar' || key === 'ArrowDown') &&
            state.activeValue === 'products'
          ) {
            Object(event)['preventDefault']?.call(event);
            state.openValue = 'products';
          } else if (key === 'Escape' && state.openValue === 'products') {
            Object(event)['preventDefault']?.call(event);
            state.value = 'escape-canceled';
          } else {
            return;
          }

          {
            if (products) {
              Object(products)['setAttribute']?.call(
                products,
                'aria-expanded',
                String(state.openValue === 'products'),
              );
            }
            if (content) content['hidden'] = state.openValue !== 'products';
            if (viewport) viewport['hidden'] = state.openValue === '';
            if (openOutput) openOutput['textContent'] = state.openValue || 'none';
            if (valueOutput) valueOutput['textContent'] = state.value;
          }
        }}
      >
        <div {...navigationMenuListAttributes(rootState)} class={LIST_CLASS}>
          <div
            {...navigationMenuItemAttributes({ ...rootState, itemValue: 'products' })}
            class={ITEM_CLASS}
          >
            <button
              {...navigationMenuTriggerAttributes({
                ...rootState,
                contentId: 'gallery-navigation-products-content',
                id: 'gallery-navigation-products-trigger',
                itemLabel: 'Products',
                itemValue: 'products',
              })}
              class={TRIGGER_CLASS}
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
          <div
            {...navigationMenuItemAttributes({ ...rootState, itemValue: 'docs' })}
            class={ITEM_CLASS}
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
          class={CONTENT_CLASS}
        >
          Platform primitives and gallery fixtures
        </div>
        <div
          {...navigationMenuViewportAttributes({ ...rootState, id: 'gallery-navigation-viewport' })}
          class={VIEWPORT_CLASS}
        />
        <output data-demo-state="navigation-open">{state.openValue || 'none'}</output>
        <output data-demo-state="navigation-value">{state.value}</output>
      </section>
    );
  },
});
