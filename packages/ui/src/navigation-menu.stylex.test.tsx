import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import * as style from '@kovojs/style';

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuIndicator,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuViewport,
} from './navigation-menu.js';

const items = [
  { label: 'Products', value: 'products' },
  { href: '/docs', label: 'Docs', value: 'docs' },
] as const;

describe('@kovojs/ui NavigationMenu StyleX slots', () => {
  it('matches navigation menu markup with StyleX slot output', () => {
    expect({
      nav: renderUiComponent(NavigationMenu, {
        activeValue: 'products',
        children:
          renderUiComponent(NavigationMenuList, {
            activeValue: 'products',
            children:
              renderUiComponent(NavigationMenuItem, {
                activeValue: 'products',
                children:
                  renderUiComponent(NavigationMenuTrigger, {
                    activeValue: 'products',
                    contentId: 'products-panel',
                    itemLabel: 'Products',
                    itemValue: 'products',
                    items,
                    openValue: 'products',
                  }) +
                  renderUiComponent(NavigationMenuContent, {
                    children: 'Product links',
                    id: 'products-panel',
                    labelledBy: 'products-trigger',
                    openValue: 'products',
                    value: 'products',
                  }),
                itemValue: 'products',
                openValue: 'products',
              }) +
              renderUiComponent(NavigationMenuItem, {
                children: renderUiComponent(NavigationMenuLink, {
                  href: '/docs',
                  itemLabel: 'Docs',
                  itemValue: 'docs',
                  items,
                  openValue: 'products',
                }),
                itemValue: 'docs',
                openValue: 'products',
              }),
            labelledBy: 'main-nav-label',
            openValue: 'products',
          }) +
          renderUiComponent(NavigationMenuViewport, {
            children: 'Viewport',
            openValue: 'products',
          }) +
          renderUiComponent(NavigationMenuIndicator, {
            openValue: 'products',
          }),
        id: 'main-nav',
        items,
        label: 'Main navigation',
        openValue: 'products',
        orientation: 'horizontal',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create({
      content: {
        backgroundColor: '#111827',
      },
      link: {
        color: '#1d4ed8',
      },
      root: {
        color: '#1d4ed8',
      },
      trigger: {
        backgroundColor: '#dbeafe',
      },
    });

    expect(
      renderUiComponent(NavigationMenu, {
        children:
          renderUiComponent(NavigationMenuTrigger, {
            itemValue: 'products',
            openValue: 'products',
            styles: { trigger: overrides.trigger },
          }) +
          renderUiComponent(NavigationMenuContent, {
            children: 'Product links',
            openValue: 'products',
            styles: { content: overrides.content },
            value: 'products',
          }) +
          renderUiComponent(NavigationMenuLink, {
            itemValue: 'docs',
            styles: { link: overrides.link },
          }),
        openValue: 'products',
        styles: { root: overrides.root },
      }),
    ).toMatchSnapshot();
  });
});
