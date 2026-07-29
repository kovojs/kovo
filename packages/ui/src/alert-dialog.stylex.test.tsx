import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

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
      open: renderUiComponent(AlertDialog, {
        children:
          renderUiComponent(AlertDialogTrigger, { ...dialogState, children: 'Delete account' }) +
          renderUiComponent(AlertDialogContent, {
            ...dialogState,
            children:
              renderUiComponent(AlertDialogHeader, {
                children:
                  renderUiComponent(AlertDialogTitle, {
                    children: 'Delete account',
                    id: 'delete-title',
                  }) +
                  renderUiComponent(AlertDialogDescription, {
                    children: 'This action is permanent.',
                    id: 'delete-description',
                  }),
              }) +
              renderUiComponent(AlertDialogFooter, {
                children:
                  renderUiComponent(AlertDialogCancel, {
                    ...dialogState,
                    autoFocus: true,
                    children: 'Cancel',
                  }) +
                  renderUiComponent(AlertDialogAction, {
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
      renderUiComponent(AlertDialog, {
        children:
          renderUiComponent(AlertDialogTrigger, {
            children: 'Delete account',
            contentId: 'delete-account',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          renderUiComponent(AlertDialogContent, {
            children: 'Confirm deletion',
            contentId: 'delete-account',
            open: true,
            styles: { content: overrides.content },
          }) +
          renderUiComponent(AlertDialogCancel, {
            contentId: 'delete-account',
            open: true,
            styles: { cancel: overrides.cancel },
          }) +
          renderUiComponent(AlertDialogAction, {
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
