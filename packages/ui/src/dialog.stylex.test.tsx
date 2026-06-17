import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  dialogClasses,
  dialogCloseClasses,
  dialogContentClasses,
  dialogStyles,
  dialogTriggerClasses,
} from './dialog.js';

describe('@kovojs/ui Dialog StyleX slots', () => {
  it('matches dialog markup with StyleX slot output', () => {
    const dialogState = { contentId: 'account-dialog', open: true as const };

    expect({
      classes: dialogClasses,
      closeClasses: dialogCloseClasses,
      contentClasses: dialogContentClasses,
      open: Dialog.definition.render({
        children:
          DialogTrigger.definition.render({ ...dialogState, children: 'Edit account' }) +
          DialogContent.definition.render({
            ...dialogState,
            children:
              '<h2 id="account-title">Account</h2><p id="account-description">Profile settings</p>',
            descriptionId: 'account-description',
            titleId: 'account-title',
          }) +
          DialogClose.definition.render({ ...dialogState, children: 'Done' }),
        id: 'dialog-root',
        open: true,
      }),
      triggerClasses: dialogTriggerClasses,
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
        close: {
          color: '#1d4ed8',
        },
        content: {
          maxWidth: 640,
        },
        root: {
          color: '#1d4ed8',
        },
        trigger: {
          backgroundColor: '#dbeafe',
        },
      },
      { namespace: 'appDialog', source: 'app-dialog.tsx' },
    );

    expect(
      Dialog.definition.render({
        children:
          DialogTrigger.definition.render({
            children: 'Edit account',
            contentId: 'account-dialog',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          DialogContent.definition.render({
            children: 'Account form',
            contentId: 'account-dialog',
            open: true,
            styles: { content: overrides.content },
          }) +
          DialogClose.definition.render({
            contentId: 'account-dialog',
            open: true,
            styles: { close: overrides.close },
          }),
        open: true,
        styles: { root: overrides.root },
      }),
    ).toMatchSnapshot();
  });

  it('exports StyleX style groups', () => {
    expect({
      closeMarker: dialogStyles.close.$$css,
      contentMarker: dialogStyles.content.$$css,
      keys: Object.keys(dialogStyles),
      rootMarker: dialogStyles.root.$$css,
      triggerMarker: dialogStyles.trigger.$$css,
    }).toMatchSnapshot();
  });
});
