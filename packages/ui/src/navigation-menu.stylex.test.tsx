import { describe, expect, it } from 'vitest';

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
  navigationMenuClasses,
  navigationMenuContentClasses,
  navigationMenuIndicatorClasses,
  navigationMenuItemClasses,
  navigationMenuLinkClasses,
  navigationMenuListClasses,
  navigationMenuStyles,
  navigationMenuTriggerClasses,
  navigationMenuViewportClasses,
} from './navigation-menu.js';

const items = [
  { label: 'Products', value: 'products' },
  { href: '/docs', label: 'Docs', value: 'docs' },
] as const;

describe('@kovojs/ui NavigationMenu StyleX slots', () => {
  it('matches navigation menu markup with StyleX slot output', () => {
    expect({
      classes: navigationMenuClasses,
      contentClasses: navigationMenuContentClasses,
      indicatorClasses: navigationMenuIndicatorClasses,
      itemClasses: navigationMenuItemClasses,
      linkClasses: navigationMenuLinkClasses,
      listClasses: navigationMenuListClasses,
      nav: NavigationMenu.definition.render({
        activeValue: 'products',
        children:
          NavigationMenuList.definition.render({
            activeValue: 'products',
            children:
              NavigationMenuItem.definition.render({
                activeValue: 'products',
                children:
                  NavigationMenuTrigger.definition.render({
                    activeValue: 'products',
                    contentId: 'products-panel',
                    itemLabel: 'Products',
                    itemValue: 'products',
                    items,
                    openValue: 'products',
                  }) +
                  NavigationMenuContent.definition.render({
                    children: 'Product links',
                    id: 'products-panel',
                    labelledBy: 'products-trigger',
                    openValue: 'products',
                    value: 'products',
                  }),
                itemValue: 'products',
                openValue: 'products',
              }) +
              NavigationMenuItem.definition.render({
                children: NavigationMenuLink.definition.render({
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
          NavigationMenuViewport.definition.render({
            children: 'Viewport',
            openValue: 'products',
          }) +
          NavigationMenuIndicator.definition.render({
            openValue: 'products',
          }),
        id: 'main-nav',
        items,
        label: 'Main navigation',
        openValue: 'products',
        orientation: 'horizontal',
      }),
      triggerClasses: navigationMenuTriggerClasses,
      viewportClasses: navigationMenuViewportClasses,
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
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
      },
      { namespace: 'appNavigationMenu', source: 'app-navigation-menu.tsx' },
    );

    expect(
      NavigationMenu.definition.render({
        children:
          NavigationMenuTrigger.definition.render({
            itemValue: 'products',
            openValue: 'products',
            styles: { trigger: overrides.trigger },
          }) +
          NavigationMenuContent.definition.render({
            children: 'Product links',
            openValue: 'products',
            styles: { content: overrides.content },
            value: 'products',
          }) +
          NavigationMenuLink.definition.render({
            itemValue: 'docs',
            styles: { link: overrides.link },
          }),
        openValue: 'products',
        styles: { root: overrides.root },
      }),
    ).toMatchSnapshot();
  });

  it('exports StyleX style groups', () => {
    expect({
      contentMarker: navigationMenuStyles.content.$$css,
      keys: Object.keys(navigationMenuStyles),
      rootMarker: navigationMenuStyles.root.$$css,
      triggerMarker: navigationMenuStyles.trigger.$$css,
    }).toMatchSnapshot();
  });
});
