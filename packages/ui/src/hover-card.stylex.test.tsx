import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  hoverCardClasses,
  hoverCardContentClasses,
  hoverCardStyles,
  hoverCardTriggerClasses,
} from './hover-card.js';

describe('@kovojs/ui HoverCard StyleX slots', () => {
  it('matches hover-card markup with StyleX slot output', () => {
    expect({
      classes: hoverCardClasses,
      contentClasses: hoverCardContentClasses,
      disabled: HoverCard.definition.render({
        children:
          HoverCardTrigger.definition.render({
            children: 'Ada',
            contentId: 'profile-card',
            disabled: true,
            href: '/team/ada',
          }) + HoverCardContent.definition.render({ children: 'Profile', contentId: 'profile-card' }),
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
      triggerClasses: hoverCardTriggerClasses,
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
          color: '#1d4ed8',
          '[data-state=open]': {
            color: '#1e3a8a',
          },
        },
      },
      { namespace: 'appHoverCard', source: 'app-hover-card.tsx' },
    );

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

  it('exports StyleX style groups', () => {
    expect({
      contentMarker: hoverCardStyles.content.$$css,
      keys: Object.keys(hoverCardStyles),
      rootMarker: hoverCardStyles.root.$$css,
      triggerMarker: hoverCardStyles.trigger.$$css,
    }).toMatchSnapshot();
  });
});
