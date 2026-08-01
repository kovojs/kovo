import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import { createWithSource } from '@kovojs/style/internal';

import { Sheet } from './sheet.js';

describe('@kovojs/ui Sheet StyleX slots', () => {
  it('matches sheet markup with StyleX slot output', () => {
    expect({
      sheet: renderUiComponent(Sheet, {
        children: 'Sheet body',
        contentId: 'account-sheet',
        description: 'Update your profile.',
        open: true,
        title: 'Account',
        trigger: 'Open sheet',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = createWithSource('sheet.stylex.test.tsx')({
      body: {
        color: '#1d4ed8',
      },
      close: {
        color: '#1d4ed8',
      },
      content: {
        maxWidth: 448,
      },
      description: {
        color: '#1e40af',
      },
      header: {
        gap: 8,
      },
      root: {
        color: '#1d4ed8',
      },
      title: {
        color: '#1d4ed8',
      },
      trigger: {
        backgroundColor: '#dbeafe',
      },
    });

    expect(
      renderUiComponent(Sheet, {
        children: 'Custom sheet body',
        closeLabel: 'Done',
        contentId: 'custom-sheet',
        description: 'Custom description',
        open: true,
        styles: {
          body: overrides.body,
          close: overrides.close,
          content: overrides.content,
          description: overrides.description,
          header: overrides.header,
          root: overrides.root,
          title: overrides.title,
          trigger: overrides.trigger,
        },
        title: 'Custom sheet',
        trigger: 'Customize',
      }),
    ).toMatchSnapshot();
  });
});
