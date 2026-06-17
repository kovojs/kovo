import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  contextMenuClasses,
  contextMenuContentClasses,
  contextMenuGroupClasses,
  contextMenuItemClasses,
  contextMenuSeparatorClasses,
  contextMenuStyles,
  contextMenuTriggerClasses,
} from './context-menu.js';

const items = [
  { label: 'Copy', value: 'copy' },
  { disabled: true, label: 'Delete', value: 'delete' },
] as const;

describe('@kovojs/ui ContextMenu StyleX slots', () => {
  it('matches context menu markup with StyleX slot output', () => {
    expect({
      classes: contextMenuClasses,
      contentClasses: contextMenuContentClasses,
      groupClasses: contextMenuGroupClasses,
      itemClasses: contextMenuItemClasses,
      menu: ContextMenu.definition.render({
        children:
          ContextMenuTrigger.definition.render({
            children: 'Right click',
            contentId: 'context-actions',
            labelledBy: 'context-label',
            open: true,
          }) +
          ContextMenuContent.definition.render({
            children: ContextMenuGroup.definition.render({
              children:
                ContextMenuItem.definition.render({
                  highlightedValue: 'copy',
                  itemLabel: 'Copy',
                  itemValue: 'copy',
                  items,
                  open: true,
                }) +
                ContextMenuSeparator.definition.render({ id: 'context-separator' }) +
                ContextMenuItem.definition.render({
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
      separatorClasses: contextMenuSeparatorClasses,
      triggerClasses: contextMenuTriggerClasses,
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
      { namespace: 'appContextMenu', source: 'app-context-menu.tsx' },
    );

    expect(
      ContextMenu.definition.render({
        children:
          ContextMenuTrigger.definition.render({
            children: 'Right click',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          ContextMenuContent.definition.render({
            children: ContextMenuItem.definition.render({
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

  it('exports StyleX style groups', () => {
    expect({
      contentMarker: contextMenuStyles.content.$$css,
      keys: Object.keys(contextMenuStyles),
      rootMarker: contextMenuStyles.root.$$css,
      triggerMarker: contextMenuStyles.trigger.$$css,
    }).toMatchSnapshot();
  });
});
