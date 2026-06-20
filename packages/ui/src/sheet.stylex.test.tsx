import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Sheet, sheetSideStyles, sheetStyles } from './sheet.js';

describe('@kovojs/ui Sheet StyleX slots', () => {
  it('matches sheet markup with StyleX slot output', () => {
    expect({
      bodyClasses: [style.attrs(sheetStyles.body).class ?? ''] as const,
      classes: [style.attrs(sheetStyles.root).class ?? ''] as const,
      closeClasses: [style.attrs(sheetStyles.close).class ?? ''] as const,
      contentClasses: [
        style.attrs(sheetStyles.content, sheetSideStyles.right).class ?? '',
        style.attrs(sheetSideStyles.bottom).class ?? '',
        style.attrs(sheetSideStyles.left).class ?? '',
        style.attrs(sheetSideStyles.top).class ?? '',
      ] as const,
      descriptionClasses: [style.attrs(sheetStyles.description).class ?? ''] as const,
      headerClasses: [style.attrs(sheetStyles.header).class ?? ''] as const,
      sheet: Sheet.definition.render({
        children: 'Sheet body',
        contentId: 'account-sheet',
        description: 'Update your profile.',
        open: true,
        title: 'Account',
        trigger: 'Open sheet',
      }),
      titleClasses: [style.attrs(sheetStyles.title).class ?? ''] as const,
      triggerClasses: [style.attrs(sheetStyles.trigger).class ?? ''] as const,
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
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
      },
      { namespace: 'appSheet', source: 'app-sheet.tsx' },
    );

    expect(
      Sheet.definition.render({
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

  it('exports StyleX style groups', () => {
    expect({
      contentMarker: sheetStyles.content.$$css,
      keys: Object.keys(sheetStyles),
      rootMarker: sheetStyles.root.$$css,
      sideKeys: Object.keys(sheetSideStyles),
      triggerMarker: sheetStyles.trigger.$$css,
    }).toMatchSnapshot();
  });
});
