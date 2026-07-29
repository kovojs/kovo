import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import * as style from '@kovojs/style';

import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator } from './breadcrumb.js';

describe('@kovojs/ui Breadcrumb StyleX styles', () => {
  it('matches breadcrumb parts with StyleX output', () => {
    expect({
      current: renderUiComponent(BreadcrumbLink, { children: 'Billing', current: true }),
      item: renderUiComponent(BreadcrumbItem, { children: 'Settings' }),
      link: renderUiComponent(BreadcrumbLink, { children: 'Account', href: '/account' }),
      root: renderUiComponent(Breadcrumb, {
        children:
          renderUiComponent(BreadcrumbItem, {
            children: renderUiComponent(BreadcrumbLink, { children: 'Account', href: '/account' }),
          }) +
          renderUiComponent(BreadcrumbSeparator, {}) +
          renderUiComponent(BreadcrumbItem, {
            children: renderUiComponent(BreadcrumbLink, { children: 'Billing', current: true }),
          }),
        label: 'Account path',
      }),
      separator: renderUiComponent(BreadcrumbSeparator, { children: '>' }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create({
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
    });

    expect(
      renderUiComponent(Breadcrumb, {
        children:
          renderUiComponent(BreadcrumbItem, {
            children: renderUiComponent(BreadcrumbLink, {
              children: 'Account',
              href: '/account',
              styles: { link: overrides.link },
            }),
            styles: { item: overrides.item },
          }) +
          renderUiComponent(BreadcrumbSeparator, {
            children: '/',
            styles: { separator: overrides.separator },
          }) +
          renderUiComponent(BreadcrumbItem, {
            children: renderUiComponent(BreadcrumbLink, {
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
});
