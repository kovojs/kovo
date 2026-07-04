import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible.js';

describe('@kovojs/ui Collapsible StyleX styles', () => {
  it('matches native details states with StyleX output', () => {
    const open = { contentId: 'release-notes', open: true as const };
    const closed = { contentId: 'archived-notes', open: false as const };

    expect({
      closed: Collapsible.definition.render({
        children:
          CollapsibleTrigger.definition.render({ ...closed, children: 'Archived notes' }) +
          CollapsibleContent.definition.render({
            ...closed,
            children: 'Older notes stay available without JavaScript.',
          }),
        id: 'collapsible-closed',
        open: false,
      }),
      disabled: Collapsible.definition.render({
        children:
          CollapsibleTrigger.definition.render({
            children: 'Disabled notes',
            contentId: 'disabled-notes',
            disabled: true,
          }) +
          CollapsibleContent.definition.render({
            children: 'Disabled content remains in the document.',
            contentId: 'disabled-notes',
            disabled: true,
          }),
        disabled: true,
        id: 'collapsible-disabled',
        open: false,
      }),
      open: Collapsible.definition.render({
        children:
          CollapsibleTrigger.definition.render({ ...open, children: 'Release notes' }) +
          CollapsibleContent.definition.render({
            ...open,
            children: 'Includes dependency updates and migration notes.',
          }),
        id: 'collapsible-open',
        open: true,
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create({
      content: {
        color: '#1d4ed8',
      },
      root: {
        borderColor: '#1d4ed8',
      },
      trigger: {
        backgroundColor: '#dbeafe',
      },
    });

    expect(
      Collapsible.definition.render({
        children:
          CollapsibleTrigger.definition.render({
            children: 'Custom release notes',
            contentId: 'custom-collapsible-content',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          CollapsibleContent.definition.render({
            children: 'Overrides should win by slot.',
            contentId: 'custom-collapsible-content',
            open: true,
            styles: { content: overrides.content },
          }),
        open: true,
        styles: { root: overrides.root },
      }),
    ).toMatchSnapshot();
  });
});
