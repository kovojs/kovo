import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import * as style from '@kovojs/style';

import { Disclosure, DisclosureContent, DisclosureTrigger } from './disclosure.js';

describe('@kovojs/ui Disclosure StyleX styles', () => {
  it('matches disclosure states with StyleX output', () => {
    const open = { contentId: 'audit-details', open: true as const };
    const closed = { contentId: 'archived-details', open: false as const };

    expect({
      closed: renderUiComponent(Disclosure, {
        children:
          renderUiComponent(DisclosureTrigger, { ...closed, children: 'Archived review' }) +
          renderUiComponent(DisclosureContent, {
            ...closed,
            children: 'Hidden until a client action re-opens it.',
          }),
        id: 'disclosure-closed',
        open: false,
      }),
      disabled: renderUiComponent(Disclosure, {
        children:
          renderUiComponent(DisclosureTrigger, {
            children: 'Disabled review',
            contentId: 'disabled-review',
            disabled: true,
            open: false,
          }) +
          renderUiComponent(DisclosureContent, {
            children: 'Disabled panels stay hidden.',
            contentId: 'disabled-review',
            disabled: true,
            open: false,
          }),
        disabled: true,
        id: 'disclosure-disabled',
        open: false,
      }),
      open: renderUiComponent(Disclosure, {
        children:
          renderUiComponent(DisclosureTrigger, { ...open, children: 'Show audit details' }) +
          renderUiComponent(DisclosureContent, {
            ...open,
            children: 'Two reviewers approved the release.',
          }),
        id: 'disclosure-open',
        open: true,
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create({
      content: {
        backgroundColor: '#eff6ff',
      },
      root: {
        rowGap: 12,
      },
      trigger: {
        borderColor: '#1d4ed8',
        color: '#1d4ed8',
      },
    });

    expect(
      renderUiComponent(Disclosure, {
        children:
          renderUiComponent(DisclosureTrigger, {
            children: 'Custom disclosure',
            contentId: 'custom-disclosure-content',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          renderUiComponent(DisclosureContent, {
            children: 'Overrides should stay author-last.',
            contentId: 'custom-disclosure-content',
            open: true,
            styles: { content: overrides.content },
          }),
        open: true,
        styles: { root: overrides.root },
      }),
    ).toMatchSnapshot();
  });
});
