// @jiso-ir - lowered from examples/gallery/src/interactive/navigation-menu-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
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
        on:keydown="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=36d82bd2#GalleryNavigationMenuDemo$section_keydown"
        fw-c="gallery-navigation-menu-demo"
        fw-state='{"activeValue":"products","openValue":"","value":"none"}'
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
              on:click="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=36d82bd2#GalleryNavigationMenuDemo$button_click"
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
              on:click="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=36d82bd2#GalleryNavigationMenuDemo$a_click"
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
