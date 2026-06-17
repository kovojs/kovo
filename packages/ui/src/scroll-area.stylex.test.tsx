import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  ScrollArea,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
  scrollAreaClasses,
  scrollAreaCornerClasses,
  scrollAreaScrollbarClasses,
  scrollAreaStyles,
  scrollAreaThumbClasses,
  scrollAreaViewportClasses,
} from './scroll-area.js';

describe('@kovojs/ui ScrollArea StyleX styles', () => {
  it('matches scroll-area parts with StyleX output', () => {
    const state = {
      dir: 'ltr' as const,
      scrollbars: 'both' as const,
    };

    expect({
      classes: scrollAreaClasses,
      corner: ScrollAreaCorner.definition.render({ ...state, id: 'activity-corner' }),
      cornerClasses: scrollAreaCornerClasses,
      hiddenThumb: ScrollAreaThumb.definition.render({
        ...state,
        forceMount: true,
        id: 'activity-thumb-x',
        orientation: 'horizontal',
        scrollPosition: 'none',
        visible: false,
      }),
      root: ScrollArea.definition.render({
        ...state,
        children: 'viewport and scrollbars',
        id: 'activity',
      }),
      scrollbarClasses: scrollAreaScrollbarClasses,
      thumbClasses: scrollAreaThumbClasses,
      verticalScrollbar: ScrollAreaScrollbar.definition.render({
        ...state,
        children: ScrollAreaThumb.definition.render({
          ...state,
          orientation: 'vertical',
          scrollPosition: 'middle',
          visible: true,
        }),
        id: 'activity-scrollbar-y',
        orientation: 'vertical',
        scrollPosition: 'middle',
        visible: true,
      }),
      viewport: ScrollAreaViewport.definition.render({
        ...state,
        children: 'feed',
        descriptionId: 'activity-description',
        id: 'activity-viewport',
        labelledBy: 'activity-title',
        scrollX: 'none',
        scrollY: 'middle',
      }),
      viewportClasses: scrollAreaViewportClasses,
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
        corner: {
          backgroundColor: '#dbeafe',
        },
        root: {
          borderColor: '#2563eb',
        },
        scrollbar: {
          backgroundColor: '#dbeafe',
        },
        thumb: {
          backgroundColor: '#2563eb',
        },
        viewport: {
          maxHeight: 160,
        },
      },
      { namespace: 'appScrollArea', source: 'app-scroll-area.tsx' },
    );

    expect(
      ScrollArea.definition.render({
        children:
          ScrollAreaViewport.definition.render({
            children: 'feed',
            styles: { viewport: overrides.viewport },
          }) +
          ScrollAreaScrollbar.definition.render({
            children: ScrollAreaThumb.definition.render({
              styles: { thumb: overrides.thumb },
              visible: true,
            }),
            styles: { scrollbar: overrides.scrollbar },
            visible: true,
          }) +
          ScrollAreaCorner.definition.render({
            styles: { corner: overrides.corner },
          }),
        styles: { root: overrides.root },
      }),
    ).toMatchSnapshot();
  });

  it('exports StyleX style groups', () => {
    expect({
      cornerMarker: scrollAreaStyles.corner.$$css,
      keys: Object.keys(scrollAreaStyles),
      rootMarker: scrollAreaStyles.root.$$css,
      scrollbarMarker: scrollAreaStyles.scrollbar.$$css,
      thumbMarker: scrollAreaStyles.thumb.$$css,
      viewportMarker: scrollAreaStyles.viewport.$$css,
    }).toMatchSnapshot();
  });
});
