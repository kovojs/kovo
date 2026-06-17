import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  breadcrumbClasses,
  breadcrumbStyles,
} from './breadcrumb.js';

describe('@kovojs/ui Breadcrumb StyleX styles', () => {
  it('matches breadcrumb parts with StyleX output', () => {
    expect({
      classes: breadcrumbClasses,
      current: BreadcrumbLink.definition.render({ children: 'Billing', current: true }),
      item: BreadcrumbItem.definition.render({ children: 'Settings' }),
      link: BreadcrumbLink.definition.render({ children: 'Account', href: '/account' }),
      root: Breadcrumb.definition.render({
        children:
          BreadcrumbItem.definition.render({
            children: BreadcrumbLink.definition.render({ children: 'Account', href: '/account' }),
          }) +
          BreadcrumbSeparator.definition.render({}) +
          BreadcrumbItem.definition.render({
            children: BreadcrumbLink.definition.render({ children: 'Billing', current: true }),
          }),
        label: 'Account path',
      }),
      separator: BreadcrumbSeparator.definition.render({ children: '>' }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
        current: {
          color: '#2563eb',
        },
        item: {
          columnGap: 10,
        },
        link: {
          color: '#2563eb',
        },
        list: {
          columnGap: 10,
        },
        root: {
          fontSize: 16,
        },
        separator: {
          color: '#2563eb',
        },
      },
      { namespace: 'appBreadcrumb', source: 'app-breadcrumb.tsx' },
    );

    expect(
      Breadcrumb.definition.render({
        children:
          BreadcrumbItem.definition.render({
            children: BreadcrumbLink.definition.render({
              children: 'Account',
              href: '/account',
              styles: { link: overrides.link },
            }),
            styles: { item: overrides.item },
          }) +
          BreadcrumbSeparator.definition.render({
            children: '/',
            styles: { separator: overrides.separator },
          }) +
          BreadcrumbItem.definition.render({
            children: BreadcrumbLink.definition.render({
              children: 'Billing',
              current: true,
              styles: { current: overrides.current },
            }),
          }),
        label: 'Account path',
        styles: {
          list: overrides.list,
          root: overrides.root,
        },
      }),
    ).toMatchSnapshot();
  });

  it('exports StyleX style groups', () => {
    expect({
      currentMarker: breadcrumbStyles.current.$$css,
      itemMarker: breadcrumbStyles.item.$$css,
      keys: Object.keys(breadcrumbStyles),
      linkMarker: breadcrumbStyles.link.$$css,
      listMarker: breadcrumbStyles.list.$$css,
      rootMarker: breadcrumbStyles.root.$$css,
      separatorMarker: breadcrumbStyles.separator.$$css,
    }).toMatchSnapshot();
  });
});
