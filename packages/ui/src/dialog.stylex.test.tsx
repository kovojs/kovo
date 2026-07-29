import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import * as style from '@kovojs/style';

import {
  Dialog,
  DialogClose,
  DialogCloseX,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog.js';

describe('@kovojs/ui Dialog StyleX slots', () => {
  it('matches dialog markup with StyleX slot output', () => {
    const dialogState = { contentId: 'account-dialog', open: true as const };

    expect({
      open: renderUiComponent(Dialog, {
        children:
          renderUiComponent(DialogTrigger, { ...dialogState, children: 'Edit account' }) +
          renderUiComponent(DialogContent, {
            ...dialogState,
            children:
              renderUiComponent(DialogCloseX, { ...dialogState }) +
              renderUiComponent(DialogHeader, {
                children:
                  renderUiComponent(DialogTitle, { children: 'Account', id: 'account-title' }) +
                  renderUiComponent(DialogDescription, {
                    children: 'Profile settings',
                    id: 'account-description',
                  }),
              }),
            descriptionId: 'account-description',
            titleId: 'account-title',
          }) +
          renderUiComponent(DialogClose, { ...dialogState, children: 'Done' }),
        id: 'dialog-root',
        open: true,
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create({
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
    });

    expect(
      renderUiComponent(Dialog, {
        children:
          renderUiComponent(DialogTrigger, {
            children: 'Edit account',
            contentId: 'account-dialog',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          renderUiComponent(DialogContent, {
            children: 'Account form',
            contentId: 'account-dialog',
            open: true,
            styles: { content: overrides.content },
          }) +
          renderUiComponent(DialogClose, {
            contentId: 'account-dialog',
            open: true,
            styles: { close: overrides.close },
          }),
        open: true,
        styles: { root: overrides.root },
      }),
    ).toMatchSnapshot();
  });
});
