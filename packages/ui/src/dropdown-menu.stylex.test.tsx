import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import { createWithSource } from '@kovojs/style/internal';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu.js';

const items = [
  { label: 'Open', value: 'open' },
  { disabled: true, label: 'Archive', value: 'archive' },
] as const;

describe('@kovojs/ui DropdownMenu StyleX slots', () => {
  it('matches dropdown menu markup with StyleX slot output', () => {
    expect({
      menu: renderUiComponent(DropdownMenu, {
        children:
          renderUiComponent(DropdownMenuTrigger, {
            children: 'Actions',
            contentId: 'actions-menu',
            labelledBy: 'actions-label',
            open: true,
          }) +
          renderUiComponent(DropdownMenuContent, {
            children: renderUiComponent(DropdownMenuGroup, {
              children:
                renderUiComponent(DropdownMenuItem, {
                  highlightedValue: 'open',
                  itemLabel: 'Open',
                  itemValue: 'open',
                  items,
                  open: true,
                }) +
                renderUiComponent(DropdownMenuSeparator, { id: 'menu-separator' }) +
                renderUiComponent(DropdownMenuItem, {
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
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = createWithSource('dropdown-menu.stylex.test.tsx')({
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
    });

    expect(
      renderUiComponent(DropdownMenu, {
        children:
          renderUiComponent(DropdownMenuTrigger, {
            children: 'Actions',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          renderUiComponent(DropdownMenuContent, {
            children: renderUiComponent(DropdownMenuItem, {
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
});
