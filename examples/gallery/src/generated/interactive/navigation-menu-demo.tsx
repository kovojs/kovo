// @kovojs-ir - lowered from examples/gallery/src/interactive/navigation-menu-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime';

export const GalleryNavigationMenuDemo$section_data_open_derive = derive(
  ['state'],
  (state: any) => state.openValue || 'none',
);
export const GalleryNavigationMenuDemo$div_data_highlighted_derive = derive(
  ['state'],
  (state: any) => (state.activeValue === 'products' ? '' : null),
);
export const GalleryNavigationMenuDemo$div_data_state_derive = derive(['state'], (state: any) =>
  state.activeValue === 'products' ? 'active' : 'inactive',
);
export const GalleryNavigationMenuDemo$button_aria_expanded_derive = derive(
  ['state'],
  (state: any) => (state.openValue === 'products' ? 'true' : 'false'),
);
export const GalleryNavigationMenuDemo$button_data_highlighted_derive = derive(
  ['state'],
  (state: any) => (state.activeValue === 'products' ? '' : null),
);
export const GalleryNavigationMenuDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.openValue === 'products' ? 'open' : 'closed',
);
export const GalleryNavigationMenuDemo$button_tabIndex_derive = derive(['state'], (state: any) =>
  state.activeValue === 'products' ? 0 : -1,
);
export const GalleryNavigationMenuDemo$div_data_highlighted_derive_2 = derive(
  ['state'],
  (state: any) => (state.activeValue === 'docs' ? '' : null),
);
export const GalleryNavigationMenuDemo$div_data_state_derive_2 = derive(['state'], (state: any) =>
  state.activeValue === 'docs' ? 'active' : 'inactive',
);
export const GalleryNavigationMenuDemo$a_data_highlighted_derive = derive(['state'], (state: any) =>
  state.activeValue === 'docs' ? '' : null,
);
export const GalleryNavigationMenuDemo$a_data_state_derive = derive(['state'], (state: any) =>
  state.activeValue === 'docs' ? 'active' : 'inactive',
);
export const GalleryNavigationMenuDemo$a_tabIndex_derive = derive(['state'], (state: any) =>
  state.activeValue === 'docs' ? 0 : -1,
);
export const GalleryNavigationMenuDemo$div_data_state_derive_3 = derive(['state'], (state: any) =>
  state.openValue === 'products' ? 'open' : 'closed',
);
export const GalleryNavigationMenuDemo$div_hidden_derive = derive(['state'], (state: any) =>
  state.openValue !== 'products' ? '' : null,
);
export const GalleryNavigationMenuDemo$div_data_state_derive_4 = derive(['state'], (state: any) =>
  state.openValue === 'products' ? 'open' : 'closed',
);
export const GalleryNavigationMenuDemo$div_hidden_derive_2 = derive(['state'], (state: any) =>
  state.openValue === '' ? '' : null,
);
export const GalleryNavigationMenuDemo$output_text_derive = derive(
  ['state'],
  (state: any) => state.openValue || 'none',
);

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
        data-bind:data-open="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$section_data_open_derive"
        on:keydown="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$section_keydown"
        kovo-c="gallery-navigation-menu-demo"
        kovo-state='{"activeValue":"products","openValue":"","value":"none"}'
      >
        <div {...navigationMenuListAttributes(rootState)} class={LIST_CLASS}>
          <div
            {...navigationMenuItemAttributes({ ...rootState, itemValue: 'products' })}
            class={ITEM_CLASS}
            data-highlighted={state.activeValue === 'products' ? '' : null}
            data-bind:data-highlighted="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$div_data_highlighted_derive"
            data-state={state.activeValue === 'products' ? 'active' : 'inactive'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$div_data_state_derive"
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
              data-bind:aria-expanded="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$button_aria_expanded_derive"
              class={TRIGGER_CLASS}
              data-highlighted={state.activeValue === 'products' ? '' : null}
              data-bind:data-highlighted="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$button_data_highlighted_derive"
              data-state={state.openValue === 'products' ? 'open' : 'closed'}
              data-bind:data-state="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$button_data_state_derive"
              tabIndex={state.activeValue === 'products' ? 0 : -1}
              data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$button_tabIndex_derive"
              on:click="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$button_click"
              on:focus="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$button_focus"
              on:pointerenter="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$button_pointerenter"
            >
              Products
            </button>
          </div>
          <div
            {...navigationMenuItemAttributes({ ...rootState, itemValue: 'docs' })}
            class={ITEM_CLASS}
            data-highlighted={state.activeValue === 'docs' ? '' : null}
            data-bind:data-highlighted="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$div_data_highlighted_derive_2"
            data-state={state.activeValue === 'docs' ? 'active' : 'inactive'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$div_data_state_derive_2"
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
              data-bind:data-highlighted="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$a_data_highlighted_derive"
              data-state={state.activeValue === 'docs' ? 'active' : 'inactive'}
              data-bind:data-state="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$a_data_state_derive"
              tabIndex={state.activeValue === 'docs' ? 0 : -1}
              data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$a_tabIndex_derive"
              on:click="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$a_click"
              on:focus="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$a_focus"
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
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$div_data_state_derive_3"
          hidden={state.openValue !== 'products'}
          data-bind:hidden="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$div_hidden_derive"
        >
          Platform primitives and gallery fixtures
        </div>
        <div
          {...navigationMenuViewportAttributes({ ...rootState, id: 'gallery-navigation-viewport' })}
          class={VIEWPORT_CLASS}
          data-state={state.openValue === 'products' ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$div_data_state_derive_4"
          hidden={state.openValue === ''}
          data-bind:hidden="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$div_hidden_derive_2"
        />
        <output
          data-demo-state="navigation-open"
          data-bind="/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js?v=d17a84e3#GalleryNavigationMenuDemo$output_text_derive"
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
