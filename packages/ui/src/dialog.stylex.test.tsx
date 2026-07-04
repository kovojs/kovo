import { describe, expect, it } from 'vitest';

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
      open: Dialog.definition.render({
        children:
          DialogTrigger.definition.render({ ...dialogState, children: 'Edit account' }) +
          DialogContent.definition.render({
            ...dialogState,
            children:
              DialogCloseX.definition.render({ ...dialogState }) +
              DialogHeader.definition.render({
                children:
                  DialogTitle.definition.render({ children: 'Account', id: 'account-title' }) +
                  DialogDescription.definition.render({
                    children: 'Profile settings',
                    id: 'account-description',
                  }),
              }),
            descriptionId: 'account-description',
            titleId: 'account-title',
          }) +
          DialogClose.definition.render({ ...dialogState, children: 'Done' }),
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
});
