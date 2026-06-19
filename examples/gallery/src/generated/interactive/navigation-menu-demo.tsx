// @kovojs-ir - lowered from examples/gallery/src/interactive/navigation-menu-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryNavigationMenuDemo$NavigationMenu_data_open_derive = derive(
  ['state'],
  (state: any) => state.openValue || 'none',
);
export const GalleryNavigationMenuDemo$NavigationMenuItem_data_highlighted_derive = derive(
  ['state'],
  (state: any) => (state.activeValue === 'products' ? '' : null),
);
export const GalleryNavigationMenuDemo$NavigationMenuItem_data_state_derive = derive(
  ['state'],
  (state: any) => (state.activeValue === 'products' ? 'active' : 'inactive'),
);
export const GalleryNavigationMenuDemo$NavigationMenuTrigger_aria_expanded_derive = derive(
  ['state'],
  (state: any) => (state.openValue === 'products' ? 'true' : 'false'),
);
export const GalleryNavigationMenuDemo$NavigationMenuTrigger_data_highlighted_derive = derive(
  ['state'],
  (state: any) => (state.activeValue === 'products' ? '' : null),
);
export const GalleryNavigationMenuDemo$NavigationMenuTrigger_data_state_derive = derive(
  ['state'],
  (state: any) => (state.openValue === 'products' ? 'open' : 'closed'),
);
export const GalleryNavigationMenuDemo$NavigationMenuTrigger_tabIndex_derive = derive(
  ['state'],
  (state: any) => (state.activeValue === 'products' ? 0 : -1),
);
export const GalleryNavigationMenuDemo$NavigationMenuItem_data_highlighted_derive_2 = derive(
  ['state'],
  (state: any) => (state.activeValue === 'docs' ? '' : null),
);
export const GalleryNavigationMenuDemo$NavigationMenuItem_data_state_derive_2 = derive(
  ['state'],
  (state: any) => (state.activeValue === 'docs' ? 'active' : 'inactive'),
);
export const GalleryNavigationMenuDemo$NavigationMenuLink_data_highlighted_derive = derive(
  ['state'],
  (state: any) => (state.activeValue === 'docs' ? '' : null),
);
export const GalleryNavigationMenuDemo$NavigationMenuLink_data_state_derive = derive(
  ['state'],
  (state: any) => (state.activeValue === 'docs' ? 'active' : 'inactive'),
);
export const GalleryNavigationMenuDemo$NavigationMenuLink_tabIndex_derive = derive(
  ['state'],
  (state: any) => (state.activeValue === 'docs' ? 0 : -1),
);
export const GalleryNavigationMenuDemo$NavigationMenuContent_data_state_derive = derive(
  ['state'],
  (state: any) => (state.openValue === 'products' ? 'open' : 'closed'),
);
export const GalleryNavigationMenuDemo$NavigationMenuContent_hidden_derive = derive(
  ['state'],
  (state: any) => (state.openValue !== 'products' ? '' : null),
);
export const GalleryNavigationMenuDemo$NavigationMenuViewport_data_state_derive = derive(
  ['state'],
  (state: any) => (state.openValue === 'products' ? 'open' : 'closed'),
);
export const GalleryNavigationMenuDemo$NavigationMenuViewport_hidden_derive = derive(
  ['state'],
  (state: any) => (state.openValue === '' ? '' : null),
);
export const GalleryNavigationMenuDemo$output_text_derive = derive(
  ['state'],
  (state: any) => state.openValue || 'none',
);

import { component } from '@kovojs/core';
import type { NavigationMenuItem as GalleryNavigationMenuItem } from '@kovojs/headless-ui/navigation-menu';
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
      ...(state.openValue === '' ? {} : { openValue: state.openValue }),
    };

    return (
      <NavigationMenu
        data-gallery-interactive="navigation-menu"
        on:keydown="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenu_keydown"
        {...rootState}
        data-open={state.openValue || 'none'}
        data-bind:data-open="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenu_data_open_derive"
        kovo-state='{"activeValue":"products","openValue":"","value":"none"}'
      >
        <NavigationMenuList {...rootState}>
          <NavigationMenuItem
            itemValue="products"
            {...rootState}
            data-highlighted={state.activeValue === 'products' ? '' : null}
            data-bind:data-highlighted="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuItem_data_highlighted_derive"
            data-state={state.activeValue === 'products' ? 'active' : 'inactive'}
            data-bind:data-state="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuItem_data_state_derive"
          >
            <NavigationMenuTrigger
              contentId="gallery-navigation-products-content"
              id="gallery-navigation-products-trigger"
              itemLabel="Products"
              itemValue="products"
              on:click="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuTrigger_click"
              on:focus="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuTrigger_focus"
              on:pointerenter="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuTrigger_pointerenter"
              {...rootState}
              aria-expanded={state.openValue === 'products' ? 'true' : 'false'}
              data-bind:aria-expanded="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuTrigger_aria_expanded_derive"
              data-highlighted={state.activeValue === 'products' ? '' : null}
              data-bind:data-highlighted="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuTrigger_data_highlighted_derive"
              data-state={state.openValue === 'products' ? 'open' : 'closed'}
              data-bind:data-state="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuTrigger_data_state_derive"
              tabIndex={state.activeValue === 'products' ? 0 : -1}
              data-bind:tabIndex="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuTrigger_tabIndex_derive"
            >
              Products
            </NavigationMenuTrigger>
          </NavigationMenuItem>
          <NavigationMenuItem
            itemValue="docs"
            {...rootState}
            data-highlighted={state.activeValue === 'docs' ? '' : null}
            data-bind:data-highlighted="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuItem_data_highlighted_derive_2"
            data-state={state.activeValue === 'docs' ? 'active' : 'inactive'}
            data-bind:data-state="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuItem_data_state_derive_2"
          >
            <NavigationMenuLink
              href="/docs"
              id="gallery-navigation-docs-link"
              itemLabel="Docs"
              itemValue="docs"
              on:click="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuLink_click"
              on:focus="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuLink_focus"
              {...rootState}
              data-highlighted={state.activeValue === 'docs' ? '' : null}
              data-bind:data-highlighted="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuLink_data_highlighted_derive"
              data-state={state.activeValue === 'docs' ? 'active' : 'inactive'}
              data-bind:data-state="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuLink_data_state_derive"
              tabIndex={state.activeValue === 'docs' ? 0 : -1}
              data-bind:tabIndex="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuLink_tabIndex_derive"
            >
              Docs
            </NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
        <NavigationMenuContent
          id="gallery-navigation-products-content"
          labelledBy="gallery-navigation-products-trigger"
          value="products"
          {...rootState}
          data-state={state.openValue === 'products' ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuContent_data_state_derive"
          hidden={state.openValue !== 'products'}
          data-bind:hidden="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuContent_hidden_derive"
        >
          Platform primitives and gallery fixtures
        </NavigationMenuContent>
        <NavigationMenuViewport
          id="gallery-navigation-viewport"
          {...rootState}
          data-state={state.openValue === 'products' ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuViewport_data_state_derive"
          hidden={state.openValue === ''}
          data-bind:hidden="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$NavigationMenuViewport_hidden_derive"
        />
        <output
          data-demo-state="navigation-open"
          data-bind="/c/__v/f6f6e610/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js#GalleryNavigationMenuDemo$output_text_derive"
        >
          {state.openValue || 'none'}
        </output>
        <output data-demo-state="navigation-value" data-bind="state.value">
          {state.value}
        </output>
      </NavigationMenu>
    );
  },
});
GalleryNavigationMenuDemo.name =
  'generated/interactive/navigation-menu-demo/gallery-navigation-menu-demo';
