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
  dialogStyles,
} from './dialog.js';

describe('@kovojs/ui Dialog StyleX slots', () => {
  it('matches dialog markup with StyleX slot output', () => {
    const dialogState = { contentId: 'account-dialog', open: true as const };

    expect({
      classes: [style.attrs(dialogStyles.root).class ?? ''] as const,
      closeClasses: [style.attrs(dialogStyles.close).class ?? ''] as const,
      closeXClasses: [style.attrs(dialogStyles.closeX).class ?? ''] as const,
      contentClasses: [style.attrs(dialogStyles.content).class ?? ''] as const,
      descriptionClasses: [style.attrs(dialogStyles.description).class ?? ''] as const,
      headerClasses: [style.attrs(dialogStyles.header).class ?? ''] as const,
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
      titleClasses: [style.attrs(dialogStyles.title).class ?? ''] as const,
      triggerClasses: [style.attrs(dialogStyles.trigger).class ?? ''] as const,
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
      closeXMarker: dialogStyles.closeX.$$css,
      contentMarker: dialogStyles.content.$$css,
      descriptionMarker: dialogStyles.description.$$css,
      headerMarker: dialogStyles.header.$$css,
      keys: Object.keys(dialogStyles),
      rootMarker: dialogStyles.root.$$css,
      titleMarker: dialogStyles.title.$$css,
      triggerMarker: dialogStyles.trigger.$$css,
    }).toMatchSnapshot();
  });
});
