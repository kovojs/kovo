import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  Menubar,
  MenubarGroup,
  MenubarItem,
  MenubarSeparator,
  MenubarSubmenu,
  menubarStyles,
} from './menubar.js';

const items = [
  { label: 'File', value: 'file' },
  { label: 'New', parentValue: 'file', value: 'new' },
  { disabled: true, label: 'Open', parentValue: 'file', value: 'open' },
] as const;

describe('@kovojs/ui Menubar StyleX slots', () => {
  it('matches menubar markup with StyleX slot output', () => {
    expect({
      classes: [style.attrs(menubarStyles.root).class ?? ''] as const,
      groupClasses: [style.attrs(menubarStyles.group).class ?? ''] as const,
      itemClasses: [style.attrs(menubarStyles.item).class ?? ''] as const,
      menubar: Menubar.definition.render({
        activeValue: 'file',
        children:
          MenubarItem.definition.render({
            activeValue: 'file',
            contentId: 'file-menu',
            itemLabel: 'File',
            itemValue: 'file',
            items,
            openValue: 'file',
          }) +
          MenubarSubmenu.definition.render({
            children: MenubarGroup.definition.render({
              children:
                MenubarItem.definition.render({
                  activeValue: 'new',
                  itemLabel: 'New',
                  itemParentValue: 'file',
                  itemValue: 'new',
                  items,
                  openValue: 'file',
                }) +
                MenubarSeparator.definition.render({ id: 'file-separator' }) +
                MenubarItem.definition.render({
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
      separatorClasses: [style.attrs(menubarStyles.separator).class ?? ''] as const,
      submenuClasses: [style.attrs(menubarStyles.submenu).class ?? ''] as const,
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
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
      },
      { namespace: 'appMenubar', source: 'app-menubar.tsx' },
    );

    expect(
      Menubar.definition.render({
        children:
          MenubarItem.definition.render({
            itemValue: 'file',
            openValue: 'file',
            styles: { item: overrides.item },
          }) +
          MenubarSubmenu.definition.render({
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

  it('exports StyleX style groups', () => {
    expect({
      itemMarker: menubarStyles.item.$$css,
      keys: Object.keys(menubarStyles),
      rootMarker: menubarStyles.root.$$css,
      submenuMarker: menubarStyles.submenu.$$css,
    }).toMatchSnapshot();
  });
});
