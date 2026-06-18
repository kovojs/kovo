import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  Sheet,
  sheetBodyClasses,
  sheetClasses,
  sheetCloseClasses,
  sheetContentClasses,
  sheetDescriptionClasses,
  sheetHeaderClasses,
  sheetSideStyles,
  sheetStyles,
  sheetTitleClasses,
  sheetTriggerClasses,
} from './sheet.js';

describe('@kovojs/ui Sheet StyleX slots', () => {
  it('matches sheet markup with StyleX slot output', () => {
    expect({
      bodyClasses: sheetBodyClasses,
      classes: sheetClasses,
      closeClasses: sheetCloseClasses,
      contentClasses: sheetContentClasses,
      descriptionClasses: sheetDescriptionClasses,
      headerClasses: sheetHeaderClasses,
      sheet: Sheet.definition.render({
        children: 'Sheet body',
        contentId: 'account-sheet',
        description: 'Update your profile.',
        open: true,
        title: 'Account',
        trigger: 'Open sheet',
      }),
      titleClasses: sheetTitleClasses,
      triggerClasses: sheetTriggerClasses,
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
