import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import * as style from '@kovojs/style';

import { Popover, PopoverContent, PopoverTrigger } from './popover.js';

describe('@kovojs/ui Popover StyleX slots', () => {
  it('matches popover markup with StyleX slot output', () => {
    expect({
      closed: renderUiComponent(Popover, {
        children:
          renderUiComponent(PopoverTrigger, { children: 'Filters', contentId: 'filters' }) +
          renderUiComponent(PopoverContent, { children: 'Menu', contentId: 'filters' }),
        id: 'filters-popover',
      }),
      open: renderUiComponent(Popover, {
        children:
          renderUiComponent(PopoverTrigger, {
            children: 'Filters',
            contentId: 'filters',
            open: true,
          }) +
          renderUiComponent(PopoverContent, { children: 'Menu', contentId: 'filters', open: true }),
        id: 'filters-popover',
        open: true,
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create({
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
    });

    expect(
      renderUiComponent(Popover, {
        children:
          renderUiComponent(PopoverTrigger, {
            children: 'Filters',
            contentId: 'filters',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          renderUiComponent(PopoverContent, {
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
});
