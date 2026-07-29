import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import * as style from '@kovojs/style';

import { Menubar, MenubarGroup, MenubarItem, MenubarSeparator, MenubarSubmenu } from './menubar.js';

const items = [
  { label: 'File', value: 'file' },
  { label: 'New', parentValue: 'file', value: 'new' },
  { disabled: true, label: 'Open', parentValue: 'file', value: 'open' },
] as const;

describe('@kovojs/ui Menubar StyleX slots', () => {
  it('matches menubar markup with StyleX slot output', () => {
    expect({
      menubar: renderUiComponent(Menubar, {
        activeValue: 'file',
        children:
          renderUiComponent(MenubarItem, {
            activeValue: 'file',
            contentId: 'file-menu',
            itemLabel: 'File',
            itemValue: 'file',
            items,
            openValue: 'file',
          }) +
          renderUiComponent(MenubarSubmenu, {
            children: renderUiComponent(MenubarGroup, {
              children:
                renderUiComponent(MenubarItem, {
                  activeValue: 'new',
                  itemLabel: 'New',
                  itemParentValue: 'file',
                  itemValue: 'new',
                  items,
                  openValue: 'file',
                }) +
                renderUiComponent(MenubarSeparator, { id: 'file-separator' }) +
                renderUiComponent(MenubarItem, {
                  itemDisabled: true,
                  itemLabel: 'Open',
                  itemParentValue: 'file',
                  itemValue: 'open',
                  items,
                  openValue: 'file',
                }),
              openValue: 'file',
            }),
            id: 'file-menu',
            labelledBy: 'file-trigger',
            openValue: 'file',
            value: 'file',
          }),
        id: 'app-menubar',
        items,
        label: 'Application',
        openValue: 'file',
        orientation: 'horizontal',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create({
      item: {
        color: '#1d4ed8',
        '[data-state=open]': {
          color: '#1e3a8a',
        },
      },
      root: {
        backgroundColor: '#dbeafe',
      },
      submenu: {
        backgroundColor: '#111827',
      },
    });

    expect(
      renderUiComponent(Menubar, {
        children:
          renderUiComponent(MenubarItem, {
            itemValue: 'file',
            openValue: 'file',
            styles: { item: overrides.item },
          }) +
          renderUiComponent(MenubarSubmenu, {
            children: 'submenu',
            openValue: 'file',
            styles: { submenu: overrides.submenu },
            value: 'file',
          }),
        openValue: 'file',
        styles: { root: overrides.root },
      }),
    ).toMatchSnapshot();
  });
});
