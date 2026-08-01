import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import { createWithSource } from '@kovojs/style/internal';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './context-menu.js';

const items = [
  { label: 'Copy', value: 'copy' },
  { disabled: true, label: 'Delete', value: 'delete' },
] as const;

describe('@kovojs/ui ContextMenu StyleX slots', () => {
  it('matches context menu markup with StyleX slot output', () => {
    expect({
      menu: renderUiComponent(ContextMenu, {
        children:
          renderUiComponent(ContextMenuTrigger, {
            children: 'Right click',
            contentId: 'context-actions',
            labelledBy: 'context-label',
            open: true,
          }) +
          renderUiComponent(ContextMenuContent, {
            children: renderUiComponent(ContextMenuGroup, {
              children:
                renderUiComponent(ContextMenuItem, {
                  highlightedValue: 'copy',
                  itemLabel: 'Copy',
                  itemValue: 'copy',
                  items,
                  open: true,
                }) +
                renderUiComponent(ContextMenuSeparator, { id: 'context-separator' }) +
                renderUiComponent(ContextMenuItem, {
                  itemDisabled: true,
                  itemLabel: 'Delete',
                  itemValue: 'delete',
                  items,
                  open: true,
                }),
              open: true,
            }),
            id: 'context-actions',
            labelledBy: 'context-label',
            open: true,
            point: { x: 32, y: 48 },
          }),
        id: 'context-root',
        open: true,
        point: { x: 32, y: 48 },
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = createWithSource('context-menu.stylex.test.tsx')({
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
      renderUiComponent(ContextMenu, {
        children:
          renderUiComponent(ContextMenuTrigger, {
            children: 'Right click',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          renderUiComponent(ContextMenuContent, {
            children: renderUiComponent(ContextMenuItem, {
              highlightedValue: 'copy',
              itemValue: 'copy',
              open: true,
              styles: { item: overrides.item },
            }),
            open: true,
            point: { x: 32, y: 48 },
            styles: { content: overrides.content },
          }),
        open: true,
        styles: { root: overrides.root },
      }),
    ).toMatchSnapshot();
  });
});
