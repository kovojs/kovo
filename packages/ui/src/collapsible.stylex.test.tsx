import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import { createWithSource } from '@kovojs/style/internal';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible.js';

describe('@kovojs/ui Collapsible StyleX styles', () => {
  it('matches native details states with StyleX output', () => {
    const open = { contentId: 'release-notes', open: true as const };
    const closed = { contentId: 'archived-notes', open: false as const };

    expect({
      closed: renderUiComponent(Collapsible, {
        children:
          renderUiComponent(CollapsibleTrigger, { ...closed, children: 'Archived notes' }) +
          renderUiComponent(CollapsibleContent, {
            ...closed,
            children: 'Older notes stay available without JavaScript.',
          }),
        id: 'collapsible-closed',
        open: false,
      }),
      disabled: renderUiComponent(Collapsible, {
        children:
          renderUiComponent(CollapsibleTrigger, {
            children: 'Disabled notes',
            contentId: 'disabled-notes',
            disabled: true,
          }) +
          renderUiComponent(CollapsibleContent, {
            children: 'Disabled content remains in the document.',
            contentId: 'disabled-notes',
            disabled: true,
          }),
        disabled: true,
        id: 'collapsible-disabled',
        open: false,
      }),
      open: renderUiComponent(Collapsible, {
        children:
          renderUiComponent(CollapsibleTrigger, { ...open, children: 'Release notes' }) +
          renderUiComponent(CollapsibleContent, {
            ...open,
            children: 'Includes dependency updates and migration notes.',
          }),
        id: 'collapsible-open',
        open: true,
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = createWithSource('collapsible.stylex.test.tsx')({
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
      renderUiComponent(Collapsible, {
        children:
          renderUiComponent(CollapsibleTrigger, {
            children: 'Custom release notes',
            contentId: 'custom-collapsible-content',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          renderUiComponent(CollapsibleContent, {
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
