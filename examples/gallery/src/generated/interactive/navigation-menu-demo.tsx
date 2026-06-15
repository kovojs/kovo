// @jiso-ir - lowered from examples/gallery/src/interactive/navigation-menu-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { derive } from '@jiso/runtime';

export const GalleryNavigationMenuDemo$output_text_derive = derive(
  ['state'],
  (state: any) => state.openValue || 'none',
);

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
        on:keydown="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=1abda1b8#GalleryNavigationMenuDemo$section_keydown"
        fw-c="gallery-navigation-menu-demo"
        fw-state='{"activeValue":"products","openValue":"","value":"none"}'
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
              on:click="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=1abda1b8#GalleryNavigationMenuDemo$button_click"
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
              on:click="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=1abda1b8#GalleryNavigationMenuDemo$a_click"
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
        <output
          data-demo-state="navigation-open"
          data-bind="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=1abda1b8#GalleryNavigationMenuDemo$output_text_derive"
        >
          {state.openValue || 'none'}
        </output>
        <output data-demo-state="navigation-value" data-bind="state.value">
          {state.value}
        </output>
      </section>
    );
  },
});
