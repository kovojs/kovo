// @kovojs-ir - lowered from examples/gallery/src/interactive/navigation-menu-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

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
  navigationMenuItemAttributes,
  navigationMenuLinkAttributes,
  navigationMenuListAttributes,
  navigationMenuRootAttributes,
  navigationMenuTriggerAttributes,
  navigationMenuViewportAttributes,
  type NavigationMenuItem,
} from '@kovojs/headless-ui/navigation-menu';
import {
  navigationMenuListClasses,
  navigationMenuItemClasses,
  navigationMenuTriggerClasses,
  navigationMenuLinkClasses,
  navigationMenuContentClasses,
  navigationMenuViewportClasses,
} from '@kovojs/ui/navigation-menu';

const LIST_CLASS = navigationMenuListClasses.join(' ');
const ITEM_CLASS = navigationMenuItemClasses.join(' ');
const TRIGGER_CLASS = navigationMenuTriggerClasses.join(' ');
const LINK_CLASS = navigationMenuLinkClasses.join(' ');
const CONTENT_CLASS = navigationMenuContentClasses.join(' ');
const VIEWPORT_CLASS = navigationMenuViewportClasses.join(' ');

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
      <section
        class="grid gap-2"
        data-gallery-interactive="navigation-menu"
        on:keydown="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$section_keydown"
        {...navigationMenuRootAttributes(rootState)}
        data-open={state.openValue || 'none'}
        data-bind:data-open="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$section_data_open_derive"
        kovo-c="gallery-navigation-menu-demo"
        kovo-state='{"activeValue":"products","openValue":"","value":"none"}'
      >
        <div class={LIST_CLASS} {...navigationMenuListAttributes(rootState)}>
          <div
            class={ITEM_CLASS}
            {...navigationMenuItemAttributes({ ...rootState, itemValue: 'products' })}
            data-highlighted={state.activeValue === 'products' ? '' : null}
            data-bind:data-highlighted="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$div_data_highlighted_derive"
            data-state={state.activeValue === 'products' ? 'active' : 'inactive'}
            data-bind:data-state="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$div_data_state_derive"
          >
            <button
              class={TRIGGER_CLASS}
              on:click="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$button_click"
              on:focus="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$button_focus"
              on:pointerenter="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$button_pointerenter"
              {...navigationMenuTriggerAttributes({
                ...rootState,
                contentId: 'gallery-navigation-products-content',
                id: 'gallery-navigation-products-trigger',
                itemLabel: 'Products',
                itemValue: 'products',
              })}
              aria-expanded={state.openValue === 'products' ? 'true' : 'false'}
              data-bind:aria-expanded="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$button_aria_expanded_derive"
              data-highlighted={state.activeValue === 'products' ? '' : null}
              data-bind:data-highlighted="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$button_data_highlighted_derive"
              data-state={state.openValue === 'products' ? 'open' : 'closed'}
              data-bind:data-state="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$button_data_state_derive"
              tabIndex={state.activeValue === 'products' ? 0 : -1}
              data-bind:tabIndex="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$button_tabIndex_derive"
            >
              Products
            </button>
          </div>
          <div
            class={ITEM_CLASS}
            {...navigationMenuItemAttributes({ ...rootState, itemValue: 'docs' })}
            data-highlighted={state.activeValue === 'docs' ? '' : null}
            data-bind:data-highlighted="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$div_data_highlighted_derive_2"
            data-state={state.activeValue === 'docs' ? 'active' : 'inactive'}
            data-bind:data-state="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$div_data_state_derive_2"
          >
            <a
              class={LINK_CLASS}
              on:click="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$a_click"
              on:focus="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$a_focus"
              {...navigationMenuLinkAttributes({
                ...rootState,
                href: '/docs',
                id: 'gallery-navigation-docs-link',
                itemLabel: 'Docs',
                itemValue: 'docs',
              })}
              data-highlighted={state.activeValue === 'docs' ? '' : null}
              data-bind:data-highlighted="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$a_data_highlighted_derive"
              data-state={state.activeValue === 'docs' ? 'active' : 'inactive'}
              data-bind:data-state="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$a_data_state_derive"
              tabIndex={state.activeValue === 'docs' ? 0 : -1}
              data-bind:tabIndex="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$a_tabIndex_derive"
            >
              Docs
            </a>
          </div>
        </div>
        <div
          class={CONTENT_CLASS}
          {...navigationMenuContentAttributes({
            ...rootState,
            id: 'gallery-navigation-products-content',
            labelledBy: 'gallery-navigation-products-trigger',
            value: 'products',
          })}
          data-state={state.openValue === 'products' ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$div_data_state_derive_3"
          hidden={state.openValue !== 'products'}
          data-bind:hidden="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$div_hidden_derive"
        >
          Platform primitives and gallery fixtures
        </div>
        <div
          class={VIEWPORT_CLASS}
          {...navigationMenuViewportAttributes({ ...rootState, id: 'gallery-navigation-viewport' })}
          data-state={state.openValue === 'products' ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$div_data_state_derive_4"
          hidden={state.openValue === ''}
          data-bind:hidden="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$div_hidden_derive_2"
        />
        <output
          data-demo-state="navigation-open"
          data-bind="/c/__v/0e4941ed/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$output_text_derive"
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
GalleryNavigationMenuDemo.name =
  'generated/interactive/navigation-menu-demo/gallery-navigation-menu-demo';
