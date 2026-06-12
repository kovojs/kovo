import { describe, expect, it } from 'vitest';

import {
  scrollAreaCornerAttributes as exportedScrollAreaCornerAttributes,
  scrollAreaCornerState as exportedScrollAreaCornerState,
  scrollAreaRootAttributes as exportedScrollAreaRootAttributes,
  scrollAreaScrollbarAttributes as exportedScrollAreaScrollbarAttributes,
  scrollAreaScrollbarState as exportedScrollAreaScrollbarState,
  scrollAreaThumbAttributes as exportedScrollAreaThumbAttributes,
  scrollAreaViewportAttributes as exportedScrollAreaViewportAttributes,
} from '../index.js';
import {
  scrollAreaCornerAttributes as primitiveScrollAreaCornerAttributes,
  scrollAreaCornerState as primitiveScrollAreaCornerState,
  scrollAreaRootAttributes as primitiveScrollAreaRootAttributes,
  scrollAreaScrollbarAttributes as primitiveScrollAreaScrollbarAttributes,
  scrollAreaScrollbarState as primitiveScrollAreaScrollbarState,
  scrollAreaThumbAttributes as primitiveScrollAreaThumbAttributes,
  scrollAreaViewportAttributes as primitiveScrollAreaViewportAttributes,
} from './index.js';
import {
  scrollAreaCornerAttributes,
  scrollAreaCornerState,
  scrollAreaRootAttributes,
  scrollAreaScrollbarAttributes,
  scrollAreaScrollbarState,
  scrollAreaThumbAttributes,
  scrollAreaViewportAttributes,
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
      }),
    ).toEqual({
      'aria-describedby': 'messages-help',
      'aria-label': 'Messages',
      'data-scrollbars': 'both',
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

  it('returns frozen attribute records', () => {
    expect(Object.isFrozen(scrollAreaRootAttributes())).toBe(true);
    expect(Object.isFrozen(scrollAreaViewportAttributes())).toBe(true);
    expect(Object.isFrozen(scrollAreaScrollbarAttributes())).toBe(true);
    expect(Object.isFrozen(scrollAreaThumbAttributes())).toBe(true);
    expect(Object.isFrozen(scrollAreaCornerAttributes())).toBe(true);
  });

  it('is exported through the package root and primitives barrel', () => {
    expect(exportedScrollAreaRootAttributes).toBe(scrollAreaRootAttributes);
    expect(exportedScrollAreaViewportAttributes).toBe(scrollAreaViewportAttributes);
    expect(exportedScrollAreaScrollbarAttributes).toBe(scrollAreaScrollbarAttributes);
    expect(exportedScrollAreaThumbAttributes).toBe(scrollAreaThumbAttributes);
    expect(exportedScrollAreaCornerAttributes).toBe(scrollAreaCornerAttributes);
    expect(exportedScrollAreaScrollbarState).toBe(scrollAreaScrollbarState);
    expect(exportedScrollAreaCornerState).toBe(scrollAreaCornerState);

    expect(primitiveScrollAreaRootAttributes).toBe(scrollAreaRootAttributes);
    expect(primitiveScrollAreaViewportAttributes).toBe(scrollAreaViewportAttributes);
    expect(primitiveScrollAreaScrollbarAttributes).toBe(scrollAreaScrollbarAttributes);
    expect(primitiveScrollAreaThumbAttributes).toBe(scrollAreaThumbAttributes);
    expect(primitiveScrollAreaCornerAttributes).toBe(scrollAreaCornerAttributes);
    expect(primitiveScrollAreaScrollbarState).toBe(scrollAreaScrollbarState);
    expect(primitiveScrollAreaCornerState).toBe(scrollAreaCornerState);
  });
});
