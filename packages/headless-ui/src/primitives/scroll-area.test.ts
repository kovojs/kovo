import { describe, expect, it } from 'vitest';

import {
  scrollAreaCornerAttributes as exportedScrollAreaCornerAttributes,
  scrollAreaCornerState as exportedScrollAreaCornerState,
  scrollAreaRootAttributes as exportedScrollAreaRootAttributes,
  scrollAreaScrollbarAttributes as exportedScrollAreaScrollbarAttributes,
  scrollAreaScrollbarState as exportedScrollAreaScrollbarState,
  scrollAreaThumbAttributes as exportedScrollAreaThumbAttributes,
  scrollAreaViewportAttributes as exportedScrollAreaViewportAttributes,
  scrollAreaViewportScroll as exportedScrollAreaViewportScroll,
  scrollAreaViewportState as exportedScrollAreaViewportState,
} from '../index.js';
import {
  scrollAreaCornerAttributes as primitiveScrollAreaCornerAttributes,
  scrollAreaCornerState as primitiveScrollAreaCornerState,
  scrollAreaRootAttributes as primitiveScrollAreaRootAttributes,
  scrollAreaScrollbarAttributes as primitiveScrollAreaScrollbarAttributes,
  scrollAreaScrollbarState as primitiveScrollAreaScrollbarState,
  scrollAreaThumbAttributes as primitiveScrollAreaThumbAttributes,
  scrollAreaViewportAttributes as primitiveScrollAreaViewportAttributes,
  scrollAreaViewportScroll as primitiveScrollAreaViewportScroll,
  scrollAreaViewportState as primitiveScrollAreaViewportState,
} from './index.js';
import {
  scrollAreaCornerAttributes,
  scrollAreaCornerState,
  scrollAreaRootAttributes,
  scrollAreaScrollbarAttributes,
  scrollAreaScrollbarState,
  scrollAreaThumbAttributes,
  scrollAreaViewportAttributes,
  scrollAreaViewportScroll,
  scrollAreaViewportState,
} from './scroll-area.js';

describe('headless-ui scroll-area primitive', () => {
  it('builds root and native viewport attributes', () => {
    expect(
      scrollAreaRootAttributes({ dir: 'rtl', id: 'messages', scrollbars: 'vertical' }),
    ).toEqual({
      'data-scrollbars': 'vertical',
      dir: 'rtl',
      id: 'messages',
    });

    expect(
      scrollAreaViewportAttributes({
        descriptionId: 'messages-help',
        id: 'messages-viewport',
        label: 'Messages',
        scrollX: 'none',
        scrollY: 'start',
      }),
    ).toEqual({
      'aria-describedby': 'messages-help',
      'aria-label': 'Messages',
      'data-scrollbars': 'both',
      'data-scroll-x': 'none',
      'data-scroll-y': 'start',
      id: 'messages-viewport',
      role: 'region',
      tabIndex: 0,
    });

    expect(scrollAreaViewportAttributes({ disabled: true, labelledBy: 'feed-title' })).toEqual({
      'aria-disabled': 'true',
      'aria-labelledby': 'feed-title',
      'data-disabled': '',
      'data-scrollbars': 'both',
      role: 'region',
      tabIndex: -1,
    });
  });

  it('builds decorative scrollbar and thumb attributes with orientation and state', () => {
    expect(
      scrollAreaScrollbarAttributes({
        id: 'messages-scrollbar-y',
        orientation: 'vertical',
        visible: true,
      }),
    ).toEqual({
      'aria-hidden': 'true',
      'data-orientation': 'vertical',
      'data-scrollbars': 'both',
      'data-state': 'visible',
      id: 'messages-scrollbar-y',
    });

    expect(scrollAreaThumbAttributes({ orientation: 'horizontal', visible: false })).toEqual({
      'aria-hidden': 'true',
      'data-orientation': 'horizontal',
      'data-scrollbars': 'both',
      'data-state': 'hidden',
      hidden: true,
    });

    expect(
      scrollAreaThumbAttributes({
        orientation: 'vertical',
        scrollPosition: 'middle',
        visible: true,
      }),
    ).toEqual({
      'aria-hidden': 'true',
      'data-orientation': 'vertical',
      'data-scroll-position': 'middle',
      'data-scrollbars': 'both',
      'data-state': 'visible',
    });
  });

  it('hides disabled or disallowed scrollbar orientations while preserving forced parts', () => {
    expect(
      scrollAreaScrollbarAttributes({
        forceMount: true,
        orientation: 'horizontal',
        scrollbars: 'vertical',
        visible: true,
      }),
    ).toEqual({
      'aria-hidden': 'true',
      'data-orientation': 'horizontal',
      'data-scrollbars': 'vertical',
      'data-state': 'hidden',
    });

    expect(
      scrollAreaScrollbarAttributes({
        disabled: true,
        orientation: 'vertical',
      }),
    ).toEqual({
      'aria-hidden': 'true',
      'data-disabled': '',
      'data-orientation': 'vertical',
      'data-scrollbars': 'both',
      'data-state': 'hidden',
      hidden: true,
    });
  });

  it('derives corner visibility from two-axis scrollbars', () => {
    expect(scrollAreaCornerAttributes()).toEqual({
      'aria-hidden': 'true',
      'data-scrollbars': 'both',
      'data-state': 'visible',
    });

    expect(scrollAreaCornerAttributes({ forceMount: true, scrollbars: 'vertical' })).toEqual({
      'aria-hidden': 'true',
      'data-scrollbars': 'vertical',
      'data-state': 'hidden',
    });

    expect(scrollAreaScrollbarState({ orientation: 'horizontal', scrollbars: 'vertical' })).toBe(
      'hidden',
    );
    expect(scrollAreaScrollbarState({ orientation: 'horizontal', scrollbars: 'both' })).toBe(
      'visible',
    );
    expect(scrollAreaCornerState({ scrollbars: 'none' })).toBe('hidden');
  });

  it('derives native viewport scroll edge and scrollbar visibility state', () => {
    expect(
      scrollAreaViewportState({
        clientHeight: 100,
        clientWidth: 200,
        scrollHeight: 400,
        scrollLeft: 0,
        scrollTop: 150,
        scrollWidth: 200,
      }),
    ).toEqual({
      cornerVisible: false,
      horizontalVisible: false,
      maxScrollLeft: 0,
      maxScrollTop: 300,
      scrollLeft: 0,
      scrollTop: 150,
      scrollX: 'none',
      scrollXRatio: 0,
      scrollY: 'middle',
      scrollYRatio: 0.5,
      verticalVisible: true,
    });

    expect(
      scrollAreaViewportState({
        clientHeight: 100,
        clientWidth: 200,
        scrollHeight: 300,
        scrollLeft: 200,
        scrollTop: 200,
        scrollWidth: 500,
      }),
    ).toMatchObject({
      cornerVisible: true,
      horizontalVisible: true,
      scrollX: 'middle',
      scrollY: 'end',
      verticalVisible: true,
    });

    expect(
      scrollAreaViewportState(
        {
          clientHeight: 100,
          clientWidth: 200,
          scrollHeight: 300,
          scrollLeft: 200,
          scrollTop: 50,
          scrollWidth: 500,
        },
        { scrollbars: 'vertical' },
      ),
    ).toMatchObject({
      cornerVisible: false,
      horizontalVisible: false,
      scrollX: 'none',
      scrollY: 'middle',
      verticalVisible: true,
    });

    expect(
      scrollAreaViewportState(
        {
          clientHeight: 100,
          clientWidth: 200,
          scrollHeight: 300,
          scrollLeft: 200,
          scrollTop: 50,
          scrollWidth: 500,
        },
        { disabled: true },
      ),
    ).toMatchObject({
      cornerVisible: false,
      horizontalVisible: false,
      scrollX: 'none',
      scrollY: 'none',
      verticalVisible: false,
    });
  });

  it('handles native viewport scroll events without blocking native scrolling', () => {
    const result = scrollAreaViewportScroll(
      scrollAreaScrollEvent({
        clientHeight: 100,
        clientWidth: 100,
        scrollHeight: 300,
        scrollLeft: 0,
        scrollTop: 200,
        scrollWidth: 100,
      }),
    );

    expect(result).toMatchObject({
      scrollY: 'end',
      verticalVisible: true,
    });
  });

  it('guards the primitive scroll handler when author behavior prevented default', () => {
    const event = scrollAreaScrollEvent({
      clientHeight: 100,
      clientWidth: 100,
      scrollHeight: 300,
      scrollLeft: 0,
      scrollTop: 200,
      scrollWidth: 100,
    });
    event.preventDefault();

    expect(scrollAreaViewportScroll(event)).toBeUndefined();
  });

  it('returns frozen attribute records', () => {
    expect(Object.isFrozen(scrollAreaRootAttributes())).toBe(true);
    expect(Object.isFrozen(scrollAreaViewportAttributes())).toBe(true);
    expect(Object.isFrozen(scrollAreaScrollbarAttributes())).toBe(true);
    expect(Object.isFrozen(scrollAreaThumbAttributes())).toBe(true);
    expect(Object.isFrozen(scrollAreaCornerAttributes())).toBe(true);
    expect(
      Object.isFrozen(
        scrollAreaViewportState({
          clientHeight: 100,
          clientWidth: 100,
          scrollHeight: 100,
          scrollLeft: 0,
          scrollTop: 0,
          scrollWidth: 100,
        }),
      ),
    ).toBe(true);
  });

  it('is exported through the package root and primitives barrel', () => {
    expect(exportedScrollAreaRootAttributes).toBe(scrollAreaRootAttributes);
    expect(exportedScrollAreaViewportAttributes).toBe(scrollAreaViewportAttributes);
    expect(exportedScrollAreaScrollbarAttributes).toBe(scrollAreaScrollbarAttributes);
    expect(exportedScrollAreaThumbAttributes).toBe(scrollAreaThumbAttributes);
    expect(exportedScrollAreaCornerAttributes).toBe(scrollAreaCornerAttributes);
    expect(exportedScrollAreaScrollbarState).toBe(scrollAreaScrollbarState);
    expect(exportedScrollAreaCornerState).toBe(scrollAreaCornerState);
    expect(exportedScrollAreaViewportState).toBe(scrollAreaViewportState);
    expect(exportedScrollAreaViewportScroll).toBe(scrollAreaViewportScroll);

    expect(primitiveScrollAreaRootAttributes).toBe(scrollAreaRootAttributes);
    expect(primitiveScrollAreaViewportAttributes).toBe(scrollAreaViewportAttributes);
    expect(primitiveScrollAreaScrollbarAttributes).toBe(scrollAreaScrollbarAttributes);
    expect(primitiveScrollAreaThumbAttributes).toBe(scrollAreaThumbAttributes);
    expect(primitiveScrollAreaCornerAttributes).toBe(scrollAreaCornerAttributes);
    expect(primitiveScrollAreaScrollbarState).toBe(scrollAreaScrollbarState);
    expect(primitiveScrollAreaCornerState).toBe(scrollAreaCornerState);
    expect(primitiveScrollAreaViewportState).toBe(scrollAreaViewportState);
    expect(primitiveScrollAreaViewportScroll).toBe(scrollAreaViewportScroll);
  });
});

function scrollAreaScrollEvent(
  currentTarget: Parameters<typeof scrollAreaViewportState>[0],
): Event & {
  readonly currentTarget: Parameters<typeof scrollAreaViewportState>[0];
} {
  const event = new Event('scroll', { cancelable: true });
  Object.defineProperty(event, 'currentTarget', {
    configurable: true,
    value: currentTarget,
  });
  return event as Event & {
    readonly currentTarget: Parameters<typeof scrollAreaViewportState>[0];
  };
}
