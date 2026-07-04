import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { HoverCard, HoverCardContent, HoverCardTrigger } from './hover-card.js';

describe('@kovojs/ui HoverCard StyleX slots', () => {
  it('matches hover-card markup with StyleX slot output', () => {
    expect({
      disabled: HoverCard.definition.render({
        children:
          HoverCardTrigger.definition.render({
            children: 'Ada',
            contentId: 'profile-card',
            disabled: true,
            href: '/team/ada',
          }) +
          HoverCardContent.definition.render({ children: 'Profile', contentId: 'profile-card' }),
        disabled: true,
      }),
      open: HoverCard.definition.render({
        children:
          HoverCardTrigger.definition.render({
            children: 'Ada',
            contentId: 'profile-card',
            href: '/team/ada',
            open: true,
          }) +
          HoverCardContent.definition.render({
            children: 'Profile',
            contentId: 'profile-card',
            open: true,
          }),
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
        color: '#1d4ed8',
        '[data-state=open]': {
          color: '#1e3a8a',
        },
      },
    });

    expect(
      HoverCard.definition.render({
        children:
          HoverCardTrigger.definition.render({
            children: 'Ada',
            contentId: 'profile-card',
            href: '/team/ada',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          HoverCardContent.definition.render({
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
