import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog.js';

describe('@kovojs/ui AlertDialog StyleX slots', () => {
  it('matches alert-dialog markup with StyleX slot output', () => {
    const dialogState = { contentId: 'delete-account', open: true as const };

    expect({
      open: AlertDialog.definition.render({
        children:
          AlertDialogTrigger.definition.render({ ...dialogState, children: 'Delete account' }) +
          AlertDialogContent.definition.render({
            ...dialogState,
            children:
              AlertDialogHeader.definition.render({
                children:
                  AlertDialogTitle.definition.render({
                    children: 'Delete account',
                    id: 'delete-title',
                  }) +
                  AlertDialogDescription.definition.render({
                    children: 'This action is permanent.',
                    id: 'delete-description',
                  }),
              }) +
              AlertDialogFooter.definition.render({
                children:
                  AlertDialogCancel.definition.render({
                    ...dialogState,
                    autoFocus: true,
                    children: 'Cancel',
                  }) +
                  AlertDialogAction.definition.render({
                    ...dialogState,
                    children: 'Delete',
                    intent: 'destructive',
                  }),
              }),
            descriptionId: 'delete-description',
            titleId: 'delete-title',
          }),
        id: 'alert-dialog-root',
        open: true,
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create({
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
    });

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
});
