import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import { createWithSource } from '@kovojs/style/internal';

import {
  ScrollArea,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from './scroll-area.js';

describe('@kovojs/ui ScrollArea StyleX styles', () => {
  it('matches scroll-area parts with StyleX output', () => {
    const state = {
      dir: 'ltr' as const,
      scrollbars: 'both' as const,
    };

    expect({
      corner: renderUiComponent(ScrollAreaCorner, { ...state, id: 'activity-corner' }),
      hiddenThumb: renderUiComponent(ScrollAreaThumb, {
        ...state,
        forceMount: true,
        id: 'activity-thumb-x',
        orientation: 'horizontal',
        scrollPosition: 'none',
        visible: false,
      }),
      root: renderUiComponent(ScrollArea, {
        ...state,
        children: 'viewport and scrollbars',
        id: 'activity',
      }),
      verticalScrollbar: renderUiComponent(ScrollAreaScrollbar, {
        ...state,
        children: renderUiComponent(ScrollAreaThumb, {
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
      viewport: renderUiComponent(ScrollAreaViewport, {
        ...state,
        children: 'feed',
        descriptionId: 'activity-description',
        id: 'activity-viewport',
        labelledBy: 'activity-title',
        scrollX: 'none',
        scrollY: 'middle',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = createWithSource('scroll-area.stylex.test.tsx')({
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
    });

    expect(
      renderUiComponent(ScrollArea, {
        children:
          renderUiComponent(ScrollAreaViewport, {
            children: 'feed',
            styles: { viewport: overrides.viewport },
          }) +
          renderUiComponent(ScrollAreaScrollbar, {
            children: renderUiComponent(ScrollAreaThumb, {
              styles: { thumb: overrides.thumb },
              visible: true,
            }),
            styles: { scrollbar: overrides.scrollbar },
            visible: true,
          }) +
          renderUiComponent(ScrollAreaCorner, {
            styles: { corner: overrides.corner },
          }),
        styles: { root: overrides.root },
      }),
    ).toMatchSnapshot();
  });
});
