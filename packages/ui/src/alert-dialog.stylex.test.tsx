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
  alertDialogStyles,
} from './alert-dialog.js';

describe('@kovojs/ui AlertDialog StyleX slots', () => {
  it('matches alert-dialog markup with StyleX slot output', () => {
    const dialogState = { contentId: 'delete-account', open: true as const };

    expect({
      actionClasses: [style.attrs(alertDialogStyles.action).class ?? ''] as const,
      cancelClasses: [style.attrs(alertDialogStyles.cancel).class ?? ''] as const,
      classes: [style.attrs(alertDialogStyles.root).class ?? ''] as const,
      contentClasses: [style.attrs(alertDialogStyles.content).class ?? ''] as const,
      descriptionClasses: [style.attrs(alertDialogStyles.description).class ?? ''] as const,
      footerClasses: [style.attrs(alertDialogStyles.footer).class ?? ''] as const,
      headerClasses: [style.attrs(alertDialogStyles.header).class ?? ''] as const,
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
      titleClasses: [style.attrs(alertDialogStyles.title).class ?? ''] as const,
      triggerClasses: [style.attrs(alertDialogStyles.trigger).class ?? ''] as const,
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
      descriptionMarker: alertDialogStyles.description.$$css,
      footerMarker: alertDialogStyles.footer.$$css,
      headerMarker: alertDialogStyles.header.$$css,
      keys: Object.keys(alertDialogStyles),
      rootMarker: alertDialogStyles.root.$$css,
      titleMarker: alertDialogStyles.title.$$css,
      triggerMarker: alertDialogStyles.trigger.$$css,
    }).toMatchSnapshot();
  });
});
