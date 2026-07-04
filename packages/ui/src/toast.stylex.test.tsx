import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastTitle,
  ToastViewport,
} from './toast.js';

describe('@kovojs/ui Toast StyleX slots', () => {
  it('matches toast states with StyleX output', () => {
    expect({
      rendered: ToastViewport.definition.render({
        children: Toast.definition.render({
          children:
            ToastTitle.definition.render({
              children: 'Deploy complete',
              id: 'toast-title',
            }) +
            ToastDescription.definition.render({
              children: 'Production received the latest release.',
              id: 'toast-description',
            }) +
            ToastAction.definition.render({
              actionValue: 'view',
              children: 'View',
              id: 'toast-action',
              open: true,
              variant: 'success',
            }) +
            ToastClose.definition.render({
              id: 'toast-close',
              open: true,
              variant: 'success',
            }),
          descriptionId: 'toast-description',
          id: 'deploy-toast',
          open: true,
          politeness: 'polite',
          titleId: 'toast-title',
          variant: 'success',
        }),
        id: 'toast-viewport',
        label: 'Notifications',
        placement: 'bottom-end',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create({
      action: {
        backgroundColor: '#dbeafe',
      },
      close: {
        color: '#1d4ed8',
      },
      description: {
        color: '#1e40af',
      },
      root: {
        borderColor: '#2563eb',
      },
      title: {
        color: '#1d4ed8',
      },
      viewport: {
        rowGap: 12,
      },
    });

    expect(
      ToastViewport.definition.render({
        children: Toast.definition.render({
          children:
            ToastTitle.definition.render({
              children: 'Custom toast',
              styles: { title: overrides.title },
            }) +
            ToastDescription.definition.render({
              children: 'Overrides should stay last.',
              styles: { description: overrides.description },
            }) +
            ToastAction.definition.render({
              children: 'Undo',
              id: 'custom-action',
              styles: { action: overrides.action },
            }) +
            ToastClose.definition.render({
              id: 'custom-close',
              styles: { close: overrides.close },
            }),
          id: 'custom-toast',
          open: true,
          styles: { root: overrides.root },
        }),
        styles: { viewport: overrides.viewport },
      }),
    ).toMatchSnapshot();
  });
});
