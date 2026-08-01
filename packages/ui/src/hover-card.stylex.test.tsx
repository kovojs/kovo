import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import { createWithSource } from '@kovojs/style/internal';

import { HoverCard, HoverCardContent, HoverCardTrigger } from './hover-card.js';

describe('@kovojs/ui HoverCard StyleX slots', () => {
  it('matches hover-card markup with StyleX slot output', () => {
    expect({
      disabled: renderUiComponent(HoverCard, {
        children:
          renderUiComponent(HoverCardTrigger, {
            children: 'Ada',
            contentId: 'profile-card',
            disabled: true,
            href: '/team/ada',
          }) +
          renderUiComponent(HoverCardContent, { children: 'Profile', contentId: 'profile-card' }),
        disabled: true,
      }),
      open: renderUiComponent(HoverCard, {
        children:
          renderUiComponent(HoverCardTrigger, {
            children: 'Ada',
            contentId: 'profile-card',
            href: '/team/ada',
            open: true,
          }) +
          renderUiComponent(HoverCardContent, {
            children: 'Profile',
            contentId: 'profile-card',
            open: true,
          }),
        open: true,
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = createWithSource('hover-card.stylex.test.tsx')({
      content: {
        width: 320,
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
      renderUiComponent(HoverCard, {
        children:
          renderUiComponent(HoverCardTrigger, {
            children: 'Ada',
            contentId: 'profile-card',
            href: '/team/ada',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          renderUiComponent(HoverCardContent, {
            children: 'Profile',
            contentId: 'profile-card',
            open: true,
            styles: { content: overrides.content },
          }),
        open: true,
        styles: { root: overrides.root },
      }),
    ).toMatchSnapshot();
  });
});
