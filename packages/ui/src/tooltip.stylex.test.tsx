import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import * as style from '@kovojs/style';

import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.js';

describe('@kovojs/ui Tooltip StyleX slots', () => {
  it('matches tooltip markup with StyleX slot output', () => {
    expect({
      disabled: renderUiComponent(Tooltip, {
        children:
          renderUiComponent(TooltipTrigger, {
            children: 'Help',
            contentId: 'tooltip-help',
            disabled: true,
          }) + renderUiComponent(TooltipContent, { children: 'Info', contentId: 'tooltip-help' }),
        disabled: true,
      }),
      open: renderUiComponent(Tooltip, {
        children:
          renderUiComponent(TooltipTrigger, {
            children: 'Help',
            contentId: 'tooltip-help',
            open: true,
          }) +
          renderUiComponent(TooltipContent, {
            children: 'Info',
            contentId: 'tooltip-help',
            open: true,
          }),
        open: true,
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create({
      content: {
        maxWidth: 288,
      },
      root: {
        color: '#1d4ed8',
      },
      trigger: {
        color: '#1d4ed8',
        '[data-state=open]': {
          color: '#1e3a8a',
        },
      },
    });

    expect(
      renderUiComponent(Tooltip, {
        children:
          renderUiComponent(TooltipTrigger, {
            children: 'Help',
            contentId: 'tooltip-help',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          renderUiComponent(TooltipContent, {
            children: 'Info',
            contentId: 'tooltip-help',
            open: true,
            styles: { content: overrides.content },
          }),
        open: true,
        styles: { root: overrides.root },
      }),
    ).toMatchSnapshot();
  });
});
