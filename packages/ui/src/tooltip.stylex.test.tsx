import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Tooltip, TooltipContent, TooltipTrigger, tooltipStyles } from './tooltip.js';

describe('@kovojs/ui Tooltip StyleX slots', () => {
  it('matches tooltip markup with StyleX slot output', () => {
    expect({
      classes: [style.attrs(tooltipStyles.root).class ?? ''] as const,
      contentClasses: [style.attrs(tooltipStyles.content).class ?? ''] as const,
      disabled: Tooltip.definition.render({
        children:
          TooltipTrigger.definition.render({
            children: 'Help',
            contentId: 'tooltip-help',
            disabled: true,
          }) + TooltipContent.definition.render({ children: 'Info', contentId: 'tooltip-help' }),
        disabled: true,
      }),
      open: Tooltip.definition.render({
        children:
          TooltipTrigger.definition.render({
            children: 'Help',
            contentId: 'tooltip-help',
            open: true,
          }) +
          TooltipContent.definition.render({
            children: 'Info',
            contentId: 'tooltip-help',
            open: true,
          }),
        open: true,
      }),
      triggerClasses: [style.attrs(tooltipStyles.trigger).class ?? ''] as const,
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
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
      },
      { namespace: 'appTooltip', source: 'app-tooltip.tsx' },
    );

    expect(
      Tooltip.definition.render({
        children:
          TooltipTrigger.definition.render({
            children: 'Help',
            contentId: 'tooltip-help',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          TooltipContent.definition.render({
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

  it('exports StyleX style groups', () => {
    expect({
      contentMarker: tooltipStyles.content.$$css,
      keys: Object.keys(tooltipStyles),
      rootMarker: tooltipStyles.root.$$css,
      triggerMarker: tooltipStyles.trigger.$$css,
    }).toMatchSnapshot();
  });
});
