import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
  disclosureStyles,
} from './disclosure.js';

describe('@kovojs/ui Disclosure StyleX styles', () => {
  it('matches disclosure states with StyleX output', () => {
    const open = { contentId: 'audit-details', open: true as const };
    const closed = { contentId: 'archived-details', open: false as const };

    expect({
      classes: [style.attrs(disclosureStyles.root).class ?? ''] as const,
      closed: Disclosure.definition.render({
        children:
          DisclosureTrigger.definition.render({ ...closed, children: 'Archived review' }) +
          DisclosureContent.definition.render({
            ...closed,
            children: 'Hidden until a client action re-opens it.',
          }),
        id: 'disclosure-closed',
        open: false,
      }),
      contentClasses: [style.attrs(disclosureStyles.content).class ?? ''] as const,
      disabled: Disclosure.definition.render({
        children:
          DisclosureTrigger.definition.render({
            children: 'Disabled review',
            contentId: 'disabled-review',
            disabled: true,
            open: false,
          }) +
          DisclosureContent.definition.render({
            children: 'Disabled panels stay hidden.',
            contentId: 'disabled-review',
            disabled: true,
            open: false,
          }),
        disabled: true,
        id: 'disclosure-disabled',
        open: false,
      }),
      open: Disclosure.definition.render({
        children:
          DisclosureTrigger.definition.render({ ...open, children: 'Show audit details' }) +
          DisclosureContent.definition.render({
            ...open,
            children: 'Two reviewers approved the release.',
          }),
        id: 'disclosure-open',
        open: true,
      }),
      triggerClasses: [style.attrs(disclosureStyles.trigger).class ?? ''] as const,
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
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
      },
      { namespace: 'appDisclosure', source: 'app-disclosure.tsx' },
    );

    expect(
      Disclosure.definition.render({
        children:
          DisclosureTrigger.definition.render({
            children: 'Custom disclosure',
            contentId: 'custom-disclosure-content',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          DisclosureContent.definition.render({
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

  it('exports StyleX style groups', () => {
    expect({
      contentMarker: disclosureStyles.content.$$css,
      keys: Object.keys(disclosureStyles),
      rootMarker: disclosureStyles.root.$$css,
      triggerMarker: disclosureStyles.trigger.$$css,
    }).toMatchSnapshot();
  });
});
