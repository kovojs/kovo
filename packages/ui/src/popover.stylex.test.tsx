import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Popover, PopoverContent, PopoverTrigger, popoverStyles } from './popover.js';

describe('@kovojs/ui Popover StyleX slots', () => {
  it('matches popover markup with StyleX slot output', () => {
    expect({
      classes: [style.attrs(popoverStyles.root).class ?? ''] as const,
      closed: Popover.definition.render({
        children:
          PopoverTrigger.definition.render({ children: 'Filters', contentId: 'filters' }) +
          PopoverContent.definition.render({ children: 'Menu', contentId: 'filters' }),
        id: 'filters-popover',
      }),
      contentClasses: [style.attrs(popoverStyles.content).class ?? ''] as const,
      open: Popover.definition.render({
        children:
          PopoverTrigger.definition.render({
            children: 'Filters',
            contentId: 'filters',
            open: true,
          }) +
          PopoverContent.definition.render({ children: 'Menu', contentId: 'filters', open: true }),
        id: 'filters-popover',
        open: true,
      }),
      triggerClasses: [style.attrs(popoverStyles.trigger).class ?? ''] as const,
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
        content: {
          width: 320,
        },
        root: {
          color: '#1d4ed8',
        },
        trigger: {
          backgroundColor: '#dbeafe',
          '[data-state=open]': {
            backgroundColor: '#bfdbfe',
          },
        },
      },
      { namespace: 'appPopover', source: 'app-popover.tsx' },
    );

    expect(
      Popover.definition.render({
        children:
          PopoverTrigger.definition.render({
            children: 'Filters',
            contentId: 'filters',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          PopoverContent.definition.render({
            children: 'Menu',
            contentId: 'filters',
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
      contentMarker: popoverStyles.content.$$css,
      keys: Object.keys(popoverStyles),
      rootMarker: popoverStyles.root.$$css,
      triggerMarker: popoverStyles.trigger.$$css,
    }).toMatchSnapshot();
  });
});
