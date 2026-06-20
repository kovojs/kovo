import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  ScrollArea,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
  scrollAreaStyles,
} from './scroll-area.js';

describe('@kovojs/ui ScrollArea StyleX styles', () => {
  it('matches scroll-area parts with StyleX output', () => {
    const state = {
      dir: 'ltr' as const,
      scrollbars: 'both' as const,
    };

    expect({
      classes: [style.attrs(scrollAreaStyles.root).class ?? ''] as const,
      corner: ScrollAreaCorner.definition.render({ ...state, id: 'activity-corner' }),
      cornerClasses: [style.attrs(scrollAreaStyles.corner).class ?? ''] as const,
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
      scrollbarClasses: [style.attrs(scrollAreaStyles.scrollbar).class ?? ''] as const,
      thumbClasses: [style.attrs(scrollAreaStyles.thumb).class ?? ''] as const,
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
      viewportClasses: [style.attrs(scrollAreaStyles.viewport).class ?? ''] as const,
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
