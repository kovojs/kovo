import { describe, expect, it } from 'vitest';

import {
  scrollAreaCornerAttributes as exportedScrollAreaCornerAttributes,
  scrollAreaCornerState as exportedScrollAreaCornerState,
  scrollAreaRootAttributes as exportedScrollAreaRootAttributes,
  scrollAreaScrollTo as exportedScrollAreaScrollTo,
  type ScrollAreaScrollToEvent as exportedScrollAreaScrollToEvent,
  scrollAreaScrollbarAttributes as exportedScrollAreaScrollbarAttributes,
  scrollAreaScrollbarState as exportedScrollAreaScrollbarState,
  scrollAreaThumbAttributes as exportedScrollAreaThumbAttributes,
  scrollAreaThumbDrag as exportedScrollAreaThumbDrag,
  scrollAreaThumbDragStart as exportedScrollAreaThumbDragStart,
  scrollAreaThumbGeometry as exportedScrollAreaThumbGeometry,
  scrollAreaTrackPointerDown as exportedScrollAreaTrackPointerDown,
  scrollAreaViewportAttributes as exportedScrollAreaViewportAttributes,
  scrollAreaViewportScroll as exportedScrollAreaViewportScroll,
  scrollAreaViewportState as exportedScrollAreaViewportState,
} from './scroll-area.js';
import {
  scrollAreaCornerAttributes as primitiveScrollAreaCornerAttributes,
  scrollAreaCornerState as primitiveScrollAreaCornerState,
  scrollAreaRootAttributes as primitiveScrollAreaRootAttributes,
  scrollAreaScrollbarAttributes as primitiveScrollAreaScrollbarAttributes,
  scrollAreaScrollbarState as primitiveScrollAreaScrollbarState,
  scrollAreaThumbAttributes as primitiveScrollAreaThumbAttributes,
  scrollAreaThumbDrag as primitiveScrollAreaThumbDrag,
  scrollAreaThumbDragStart as primitiveScrollAreaThumbDragStart,
  scrollAreaThumbGeometry as primitiveScrollAreaThumbGeometry,
  scrollAreaTrackPointerDown as primitiveScrollAreaTrackPointerDown,
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
  scrollAreaThumbDrag,
  scrollAreaThumbDragStart,
  scrollAreaThumbGeometry,
  scrollAreaTrackPointerDown,
  scrollAreaViewportAttributes,
  scrollAreaViewportScroll,
  scrollAreaViewportState,
} from './scroll-area.js';

describe('headless-ui scroll-area primitive', () => {
  it('builds root and native viewport attributes', () => {
    expect(
      scrollAreaRootAttributes({
        dir: 'rtl',
        hasOverflowY: true,
        hovering: true,
        id: 'messages',
        scrolling: true,
        scrollbars: 'vertical',
      }),
    ).toEqual({
      'data-has-overflow-y': '',
      'data-hovering': '',
      'data-scrolling': '',
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

  it('derives proportional thumb geometry from native viewport state', () => {
    expect(
      scrollAreaThumbGeometry({
        clientHeight: 100,
        clientWidth: 200,
        scrollHeight: 400,
        scrollLeft: 0,
        scrollTop: 150,
        scrollWidth: 200,
      }),
    ).toEqual({
      offsetRatio: 0.5,
      scrollPosition: 'middle',
      sizeRatio: 0.25,
      visible: true,
    });

    expect(
      scrollAreaThumbGeometry({
        clientHeight: 100,
        clientWidth: 200,
        scrollHeight: 100,
        scrollLeft: 0,
        scrollTop: 0,
        scrollWidth: 200,
      }),
    ).toEqual({
      offsetRatio: 0,
      scrollPosition: 'none',
      sizeRatio: 0,
      visible: false,
    });
  });

  it('computes track-click target scroll offsets from pointer position', () => {
    const event = scrollAreaPointerEvent({
      clientY: 80,
      currentTarget: { clientHeight: 100 },
      offsetY: 80,
    });
    const result = scrollAreaTrackPointerDown(
      event,
      {
        clientHeight: 100,
        clientWidth: 100,
        scrollHeight: 300,
        scrollLeft: 0,
        scrollTop: 0,
        scrollWidth: 100,
      },
      { orientation: 'vertical', scrollbars: 'vertical' },
    );

    expect(result).toMatchObject({
      scrollTop: 190,
      scrollY: 'middle',
      scrollYRatio: 0.95,
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it('computes thumb drag start and pointer-move scroll offsets', () => {
    const viewport = {
      clientHeight: 100,
      clientWidth: 100,
      scrollHeight: 300,
      scrollLeft: 0,
      scrollTop: 50,
      scrollWidth: 100,
    };
    const start = scrollAreaThumbDragStart(
      scrollAreaPointerEvent({
        clientY: 25,
        currentTarget: {
          clientHeight: 25,
          parentElement: { clientHeight: 100 },
        },
      }),
      viewport,
      { orientation: 'vertical', scrollbars: 'vertical' },
    );

    expect(start).toEqual({
      pointerStart: 25,
      scrollStart: 50,
      thumbSize: 25,
      trackSize: 100,
    });

    const dragEvent = scrollAreaPointerEvent({ clientY: 55 });
    const result = scrollAreaThumbDrag(dragEvent, viewport, {
      orientation: 'vertical',
      pointerStart: start?.pointerStart ?? 0,
      scrollStart: start?.scrollStart ?? 0,
      scrollbars: 'vertical',
      thumbSize: start?.thumbSize ?? 0,
      trackSize: start?.trackSize ?? 0,
    });

    expect(result).toMatchObject({
      scrollTop: 130,
      scrollY: 'middle',
    });
    expect(dragEvent.defaultPrevented).toBe(true);
  });

  it('reads delegated scroll events from the event target', () => {
    const result = scrollAreaViewportScroll(
      scrollAreaDelegatedScrollEvent({
        clientHeight: 100,
        clientWidth: 100,
        scrollHeight: 300,
        scrollLeft: 0,
        scrollTop: 100,
        scrollWidth: 100,
      }),
    );

    expect(result).toMatchObject({
      scrollY: 'middle',
      scrollYRatio: 0.5,
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
    expect(
      Object.isFrozen(
        scrollAreaThumbGeometry({
          clientHeight: 100,
          clientWidth: 100,
          scrollHeight: 100,
          scrollLeft: 0,
          scrollTop: 0,
          scrollWidth: 100,
        }),
      ),
    ).toBe(true);
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
    expect(exportedScrollAreaThumbGeometry).toBe(scrollAreaThumbGeometry);
    expect(exportedScrollAreaThumbDrag).toBe(scrollAreaThumbDrag);
    expect(exportedScrollAreaThumbDragStart).toBe(scrollAreaThumbDragStart);
    expect(exportedScrollAreaTrackPointerDown).toBe(scrollAreaTrackPointerDown);
    expect(exportedScrollAreaCornerAttributes).toBe(scrollAreaCornerAttributes);
    expect(exportedScrollAreaScrollbarState).toBe(scrollAreaScrollbarState);
    expect(exportedScrollAreaCornerState).toBe(scrollAreaCornerState);
    expect(exportedScrollAreaViewportState).toBe(scrollAreaViewportState);
    expect(exportedScrollAreaViewportScroll).toBe(scrollAreaViewportScroll);

    expect(primitiveScrollAreaRootAttributes).toBe(scrollAreaRootAttributes);
    expect(primitiveScrollAreaViewportAttributes).toBe(scrollAreaViewportAttributes);
    expect(primitiveScrollAreaScrollbarAttributes).toBe(scrollAreaScrollbarAttributes);
    expect(primitiveScrollAreaThumbAttributes).toBe(scrollAreaThumbAttributes);
    expect(primitiveScrollAreaThumbGeometry).toBe(scrollAreaThumbGeometry);
    expect(primitiveScrollAreaThumbDrag).toBe(scrollAreaThumbDrag);
    expect(primitiveScrollAreaThumbDragStart).toBe(scrollAreaThumbDragStart);
    expect(primitiveScrollAreaTrackPointerDown).toBe(scrollAreaTrackPointerDown);
    expect(primitiveScrollAreaCornerAttributes).toBe(scrollAreaCornerAttributes);
    expect(primitiveScrollAreaScrollbarState).toBe(scrollAreaScrollbarState);
    expect(primitiveScrollAreaCornerState).toBe(scrollAreaCornerState);
    expect(primitiveScrollAreaViewportState).toBe(scrollAreaViewportState);
    expect(primitiveScrollAreaViewportScroll).toBe(scrollAreaViewportScroll);
  });
});

describe('scrollAreaScrollTo', () => {
  function fakeTrigger(
    controls: string | null,
    viewport: { scrollHeight: number; scrollTop: number },
  ) {
    return {
      getAttribute: (name: string) => (name === 'aria-controls' ? controls : null),
      ownerDocument: { getElementById: (id: string) => (id === controls ? viewport : null) },
    };
  }
  function clickEvent(currentTarget: unknown, defaultPrevented = false) {
    return { currentTarget, defaultPrevented } as unknown as exportedScrollAreaScrollToEvent;
  }

  it('scrolls the aria-controls viewport to the bottom for position=end', () => {
    const viewport = { scrollHeight: 260, scrollTop: 0 };
    const result = exportedScrollAreaScrollTo(clickEvent(fakeTrigger('vp', viewport)), {
      position: 'end',
    });
    expect(viewport.scrollTop).toBe(260);
    expect(result).toEqual({ scrollTop: 260, scrollY: 'end' });
  });

  it('scrolls to the top for position=start', () => {
    const viewport = { scrollHeight: 260, scrollTop: 200 };
    const result = exportedScrollAreaScrollTo(clickEvent(fakeTrigger('vp', viewport)), {
      position: 'start',
    });
    expect(viewport.scrollTop).toBe(0);
    expect(result).toEqual({ scrollTop: 0, scrollY: 'start' });
  });

  it('no-ops when default is prevented or the viewport is missing', () => {
    const viewport = { scrollHeight: 260, scrollTop: 50 };
    expect(
      exportedScrollAreaScrollTo(clickEvent(fakeTrigger('vp', viewport), true), {
        position: 'end',
      }),
    ).toBeUndefined();
    expect(viewport.scrollTop).toBe(50);
    expect(
      exportedScrollAreaScrollTo(clickEvent(fakeTrigger(null, viewport)), { position: 'end' }),
    ).toBeUndefined();
    expect(viewport.scrollTop).toBe(50);
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

function scrollAreaDelegatedScrollEvent(
  target: Parameters<typeof scrollAreaViewportState>[0],
): Event & {
  readonly currentTarget: null;
  readonly target: Parameters<typeof scrollAreaViewportState>[0];
} {
  const event = new Event('scroll', { cancelable: true });
  Object.defineProperty(event, 'currentTarget', {
    configurable: true,
    value: null,
  });
  Object.defineProperty(event, 'target', {
    configurable: true,
    value: target,
  });
  return event as Event & {
    readonly currentTarget: null;
    readonly target: Parameters<typeof scrollAreaViewportState>[0];
  };
}

function scrollAreaPointerEvent(options: {
  clientX?: number;
  clientY?: number;
  currentTarget?: {
    clientHeight?: number;
    clientWidth?: number;
    parentElement?: {
      clientHeight?: number;
      clientWidth?: number;
    };
  };
  offsetX?: number;
  offsetY?: number;
}): Event & {
  readonly clientX?: number;
  readonly clientY?: number;
  readonly currentTarget?: {
    clientHeight?: number;
    clientWidth?: number;
    parentElement?: {
      clientHeight?: number;
      clientWidth?: number;
    };
  };
  readonly offsetX?: number;
  readonly offsetY?: number;
} {
  const event = new Event('pointerdown', { cancelable: true }) as Event & {
    clientX?: number;
    clientY?: number;
    currentTarget?: {
      clientHeight?: number;
      clientWidth?: number;
      parentElement?: {
        clientHeight?: number;
        clientWidth?: number;
      };
    };
    offsetX?: number;
    offsetY?: number;
  };
  for (const [key, value] of Object.entries(options)) {
    Object.defineProperty(event, key, {
      configurable: true,
      value,
    });
  }
  return event;
}
