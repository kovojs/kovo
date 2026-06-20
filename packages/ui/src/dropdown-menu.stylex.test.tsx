import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  dropdownMenuStyles,
} from './dropdown-menu.js';

const items = [
  { label: 'Open', value: 'open' },
  { disabled: true, label: 'Archive', value: 'archive' },
] as const;

describe('@kovojs/ui DropdownMenu StyleX slots', () => {
  it('matches dropdown menu markup with StyleX slot output', () => {
    expect({
      classes: [style.attrs(dropdownMenuStyles.root).class ?? ''] as const,
      contentClasses: [style.attrs(dropdownMenuStyles.content).class ?? ''] as const,
      groupClasses: [style.attrs(dropdownMenuStyles.group).class ?? ''] as const,
      itemClasses: [style.attrs(dropdownMenuStyles.item).class ?? ''] as const,
      menu: DropdownMenu.definition.render({
        children:
          DropdownMenuTrigger.definition.render({
            children: 'Actions',
            contentId: 'actions-menu',
            labelledBy: 'actions-label',
            open: true,
          }) +
          DropdownMenuContent.definition.render({
            children: DropdownMenuGroup.definition.render({
              children:
                DropdownMenuItem.definition.render({
                  highlightedValue: 'open',
                  itemLabel: 'Open',
                  itemValue: 'open',
                  items,
                  open: true,
                }) +
                DropdownMenuSeparator.definition.render({ id: 'menu-separator' }) +
                DropdownMenuItem.definition.render({
                  itemDisabled: true,
                  itemLabel: 'Archive',
                  itemValue: 'archive',
                  items,
                  open: true,
                }),
              open: true,
            }),
            id: 'actions-menu',
            labelledBy: 'actions-label',
            open: true,
          }),
        id: 'actions-root',
        open: true,
      }),
      separatorClasses: [style.attrs(dropdownMenuStyles.separator).class ?? ''] as const,
      triggerClasses: [style.attrs(dropdownMenuStyles.trigger).class ?? ''] as const,
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
        content: {
          backgroundColor: '#111827',
        },
        item: {
          color: '#1d4ed8',
          '[data-highlighted]': {
            color: '#1e3a8a',
          },
        },
        root: {
          color: '#1d4ed8',
        },
        trigger: {
          backgroundColor: '#dbeafe',
        },
      },
      { namespace: 'appDropdownMenu', source: 'app-dropdown-menu.tsx' },
    );

    expect(
      DropdownMenu.definition.render({
        children:
          DropdownMenuTrigger.definition.render({
            children: 'Actions',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          DropdownMenuContent.definition.render({
            children: DropdownMenuItem.definition.render({
              highlightedValue: 'open',
              itemValue: 'open',
              open: true,
              styles: { item: overrides.item },
            }),
            open: true,
            styles: { content: overrides.content },
          }),
        open: true,
        styles: { root: overrides.root },
      }),
    ).toMatchSnapshot();
  });

  it('exports StyleX style groups', () => {
    expect({
      contentMarker: dropdownMenuStyles.content.$$css,
      keys: Object.keys(dropdownMenuStyles),
      rootMarker: dropdownMenuStyles.root.$$css,
      triggerMarker: dropdownMenuStyles.trigger.$$css,
    }).toMatchSnapshot();
  });
});
