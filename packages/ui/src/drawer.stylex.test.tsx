import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Drawer, drawerSideStyles, drawerStyles } from './drawer.js';

describe('@kovojs/ui Drawer StyleX slots', () => {
  it('matches drawer markup with StyleX slot output', () => {
    expect({
      bodyClasses: [style.attrs(drawerStyles.body).class ?? ''] as const,
      classes: [style.attrs(drawerStyles.root).class ?? ''] as const,
      closeClasses: [style.attrs(drawerStyles.close).class ?? ''] as const,
      contentClasses: [
        style.attrs(drawerStyles.content, drawerSideStyles.bottom).class ?? '',
        style.attrs(drawerSideStyles.left).class ?? '',
        style.attrs(drawerSideStyles.right).class ?? '',
        style.attrs(drawerSideStyles.top).class ?? '',
      ] as const,
      descriptionClasses: [style.attrs(drawerStyles.description).class ?? ''] as const,
      handleClasses: [style.attrs(drawerStyles.handle).class ?? ''] as const,
      headerClasses: [style.attrs(drawerStyles.header).class ?? ''] as const,
      open: Drawer.definition.render({
        children: 'Drawer body',
        contentId: 'standalone-drawer',
        description: 'Standalone drawer description.',
        open: true,
        title: 'Standalone drawer',
        trigger: 'Open drawer',
      }),
      titleClasses: [style.attrs(drawerStyles.title).class ?? ''] as const,
      triggerClasses: [style.attrs(drawerStyles.trigger).class ?? ''] as const,
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
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
      },
      { namespace: 'appDrawer', source: 'app-drawer.tsx' },
    );

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

  it('exports StyleX style groups', () => {
    expect({
      contentMarker: drawerStyles.content.$$css,
      handleMarker: drawerStyles.handle.$$css,
      keys: Object.keys(drawerStyles),
      rootMarker: drawerStyles.root.$$css,
      sideKeys: Object.keys(drawerSideStyles),
      triggerMarker: drawerStyles.trigger.$$css,
    }).toMatchSnapshot();
  });
});
