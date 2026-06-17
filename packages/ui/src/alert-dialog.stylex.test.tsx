import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTrigger,
  alertDialogActionClasses,
  alertDialogCancelClasses,
  alertDialogClasses,
  alertDialogContentClasses,
  alertDialogStyles,
  alertDialogTriggerClasses,
} from './alert-dialog.js';

describe('@kovojs/ui AlertDialog StyleX slots', () => {
  it('matches alert-dialog markup with StyleX slot output', () => {
    const dialogState = { contentId: 'delete-account', open: true as const };

    expect({
      actionClasses: alertDialogActionClasses,
      cancelClasses: alertDialogCancelClasses,
      classes: alertDialogClasses,
      contentClasses: alertDialogContentClasses,
      open: AlertDialog.definition.render({
        children:
          AlertDialogTrigger.definition.render({ ...dialogState, children: 'Delete account' }) +
          AlertDialogContent.definition.render({
            ...dialogState,
            children:
              '<h2 id="delete-title">Delete account</h2><p id="delete-description">This action is permanent.</p>',
            descriptionId: 'delete-description',
            titleId: 'delete-title',
          }) +
          AlertDialogCancel.definition.render({ ...dialogState, autoFocus: true, children: 'Cancel' }) +
          AlertDialogAction.definition.render({
            ...dialogState,
            children: 'Delete',
            intent: 'destructive',
          }),
        id: 'alert-dialog-root',
        open: true,
      }),
      triggerClasses: alertDialogTriggerClasses,
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
        action: {
          backgroundColor: '#991b1b',
        },
        cancel: {
          color: '#1d4ed8',
        },
        content: {
          maxWidth: 560,
        },
        root: {
          color: '#1d4ed8',
        },
        trigger: {
          backgroundColor: '#dbeafe',
        },
      },
      { namespace: 'appAlertDialog', source: 'app-alert-dialog.tsx' },
    );

    expect(
      AlertDialog.definition.render({
        children:
          AlertDialogTrigger.definition.render({
            children: 'Delete account',
            contentId: 'delete-account',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          AlertDialogContent.definition.render({
            children: 'Confirm deletion',
            contentId: 'delete-account',
            open: true,
            styles: { content: overrides.content },
          }) +
          AlertDialogCancel.definition.render({
            contentId: 'delete-account',
            open: true,
            styles: { cancel: overrides.cancel },
          }) +
          AlertDialogAction.definition.render({
            children: 'Delete',
            contentId: 'delete-account',
            intent: 'destructive',
            open: true,
            styles: { action: overrides.action },
          }),
        open: true,
        styles: { root: overrides.root },
      }),
    ).toMatchSnapshot();
  });

  it('exports StyleX style groups', () => {
    expect({
      actionMarker: alertDialogStyles.action.$$css,
      cancelMarker: alertDialogStyles.cancel.$$css,
      contentMarker: alertDialogStyles.content.$$css,
      keys: Object.keys(alertDialogStyles),
      rootMarker: alertDialogStyles.root.$$css,
      triggerMarker: alertDialogStyles.trigger.$$css,
    }).toMatchSnapshot();
  });
});
