import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  Drawer,
  drawerBodyClasses,
  drawerClasses,
  drawerCloseClasses,
  drawerContentClasses,
  drawerDescriptionClasses,
  drawerHandleClasses,
  drawerHeaderClasses,
  drawerSideStyles,
  drawerStyles,
  drawerTitleClasses,
  drawerTriggerClasses,
} from './drawer.js';

describe('@kovojs/ui Drawer StyleX slots', () => {
  it('matches drawer markup with StyleX slot output', () => {
    expect({
      bodyClasses: drawerBodyClasses,
      classes: drawerClasses,
      closeClasses: drawerCloseClasses,
      contentClasses: drawerContentClasses,
      descriptionClasses: drawerDescriptionClasses,
      handleClasses: drawerHandleClasses,
      headerClasses: drawerHeaderClasses,
      open: Drawer.definition.render({
        children: 'Drawer body',
        contentId: 'standalone-drawer',
        description: 'Standalone drawer description.',
        open: true,
        title: 'Standalone drawer',
        trigger: 'Open drawer',
      }),
      titleClasses: drawerTitleClasses,
      triggerClasses: drawerTriggerClasses,
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
