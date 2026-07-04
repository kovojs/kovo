import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Drawer } from './drawer.js';

describe('@kovojs/ui Drawer StyleX slots', () => {
  it('matches drawer markup with StyleX slot output', () => {
    expect({
      open: Drawer.definition.render({
        children: 'Drawer body',
        contentId: 'standalone-drawer',
        description: 'Standalone drawer description.',
        open: true,
        title: 'Standalone drawer',
        trigger: 'Open drawer',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create({
      body: {
        color: '#1d4ed8',
      },
      close: {
        color: '#1d4ed8',
      },
      content: {
        maxHeight: '70vh',
      },
      description: {
        color: '#1e40af',
      },
      handle: {
        backgroundColor: '#1d4ed8',
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
    });

    expect(
      Drawer.definition.render({
        children: 'Custom drawer body',
        closeLabel: 'Done',
        contentId: 'custom-drawer',
        description: 'Custom description',
        open: true,
        styles: {
          body: overrides.body,
          close: overrides.close,
          content: overrides.content,
          description: overrides.description,
          handle: overrides.handle,
          header: overrides.header,
          root: overrides.root,
          title: overrides.title,
          trigger: overrides.trigger,
        },
        title: 'Custom drawer',
        trigger: 'Customize',
      }),
    ).toMatchSnapshot();
  });
});
