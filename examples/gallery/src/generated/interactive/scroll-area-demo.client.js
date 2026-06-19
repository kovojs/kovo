// @kovojs-ir
import { derive, handler, kovoStyleProperty } from '@kovojs/runtime/generated';

import {
  scrollAreaThumbDrag as _scrollAreaThumbDrag,
  scrollAreaThumbDragStart as _scrollAreaThumbDragStart,
  scrollAreaThumbGeometry as _scrollAreaThumbGeometry,
  scrollAreaTrackPointerDown as _scrollAreaTrackPointerDown,
  scrollAreaViewportScroll as _scrollAreaViewportScroll,
} from '@kovojs/ui/scroll-area';

export const GalleryScrollAreaDemo$ScrollArea_pointerenter = handler((_event, ctx) => {
  ctx.state.hovering = true;
});
export const GalleryScrollAreaDemo$ScrollArea_pointerleave = handler((_event, ctx) => {
  ctx.state.hovering = false;
  ctx.state.dragging = false;
});
export const GalleryScrollAreaDemo$ScrollAreaViewport_scroll = handler((event, ctx) => {
  const result = _scrollAreaViewportScroll(Object(event), { scrollbars: 'vertical' });
  if (!result) return;

  const geometry = _scrollAreaThumbGeometry(Object(event)['target'], {
    orientation: 'vertical',
    scrollbars: 'vertical',
  });
  ctx.state.scrollTop = result.scrollTop;
  ctx.state.scrollY = result.scrollY;
  ctx.state.thumbOffset = geometry.offsetRatio * 100;
  ctx.state.thumbSize = geometry.sizeRatio * 100 < 12 ? 12 : geometry.sizeRatio * 100;
  ctx.state.hasOverflowY = result.verticalVisible;
  ctx.state.scrolling = true;
  ctx.state.verticalVisible = geometry.visible;
});
export const GalleryScrollAreaDemo$ScrollAreaScrollbar_pointerdown = handler((event, ctx) => {
  const result = _scrollAreaTrackPointerDown(
    Object(event),
    {
      clientHeight: 72,
      clientWidth: 240,
      scrollHeight: 260,
      scrollLeft: 0,
      scrollTop: ctx.state.scrollTop,
      scrollWidth: 240,
    },
    {
      orientation: 'vertical',
      scrollbars: 'vertical',
    },
  );
  if (!result) return;

  const geometry = _scrollAreaThumbGeometry(
    {
      clientHeight: 72,
      clientWidth: 240,
      scrollHeight: 260,
      scrollLeft: 0,
      scrollTop: result.scrollTop,
      scrollWidth: 240,
    },
    {
      orientation: 'vertical',
      scrollbars: 'vertical',
    },
  );
  ctx.state.scrollTop = result.scrollTop;
  ctx.state.scrollY = result.scrollY;
  ctx.state.thumbOffset = geometry.offsetRatio * 100;
  ctx.state.thumbSize = geometry.sizeRatio * 100 < 12 ? 12 : geometry.sizeRatio * 100;
  ctx.state.hasOverflowY = result.verticalVisible;
  ctx.state.scrolling = true;
  ctx.state.verticalVisible = geometry.visible;
});
export const GalleryScrollAreaDemo$ScrollAreaThumb_pointerdown = handler((event, ctx) => {
  const result = _scrollAreaThumbDragStart(
    Object(event),
    {
      clientHeight: 72,
      clientWidth: 240,
      scrollHeight: 260,
      scrollLeft: 0,
      scrollTop: ctx.state.scrollTop,
      scrollWidth: 240,
    },
    {
      orientation: 'vertical',
      scrollbars: 'vertical',
    },
  );
  if (!result) return;

  ctx.state.dragging = true;
  ctx.state.dragPointerStart = result.pointerStart;
  ctx.state.dragScrollTop = result.scrollStart;
  ctx.state.dragThumbSize = result.thumbSize;
  ctx.state.dragTrackSize = result.trackSize;
  ctx.state.scrolling = true;
});
export const GalleryScrollAreaDemo$ScrollAreaThumb_pointermove = handler((event, ctx) => {
  if (!ctx.state.dragging) return;
  const result = _scrollAreaThumbDrag(
    Object(event),
    {
      clientHeight: 72,
      clientWidth: 240,
      scrollHeight: 260,
      scrollLeft: 0,
      scrollTop: ctx.state.scrollTop,
      scrollWidth: 240,
    },
    {
      orientation: 'vertical',
      pointerStart: ctx.state.dragPointerStart,
      scrollStart: ctx.state.dragScrollTop,
      scrollbars: 'vertical',
      thumbSize: ctx.state.dragThumbSize,
      trackSize: ctx.state.dragTrackSize,
    },
  );
  if (!result) return;

  const geometry = _scrollAreaThumbGeometry(
    {
      clientHeight: 72,
      clientWidth: 240,
      scrollHeight: 260,
      scrollLeft: 0,
      scrollTop: result.scrollTop,
      scrollWidth: 240,
    },
    {
      orientation: 'vertical',
      scrollbars: 'vertical',
    },
  );
  ctx.state.scrollTop = result.scrollTop;
  ctx.state.scrollY = result.scrollY;
  ctx.state.thumbOffset = geometry.offsetRatio * 100;
  ctx.state.thumbSize = geometry.sizeRatio * 100 < 12 ? 12 : geometry.sizeRatio * 100;
  ctx.state.hasOverflowY = result.verticalVisible;
  ctx.state.scrolling = true;
  ctx.state.verticalVisible = geometry.visible;
});
export const GalleryScrollAreaDemo$ScrollAreaThumb_pointerup = handler((_event, ctx) => {
  ctx.state.dragging = false;
  ctx.state.scrolling = false;
});
export const GalleryScrollAreaDemo$button_click = handler((_event, ctx) => {
  const nextAtEnd = ctx.state.scrollY !== 'end';
  ctx.state.scrollTop = nextAtEnd ? 1000000 : 0;
  ctx.state.scrollY = nextAtEnd ? 'end' : 'start';
  ctx.state.thumbOffset = nextAtEnd ? 100 : 0;
  ctx.state.scrolling = true;
});

export const GalleryScrollAreaDemo$ScrollArea_data_dragging_derive = derive(['state'], (state) =>
  state.dragging ? '' : null,
);
export const GalleryScrollAreaDemo$ScrollArea_data_has_overflow_y_derive = derive(
  ['state'],
  (state) => (state.hasOverflowY ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollArea_data_hovering_derive = derive(['state'], (state) =>
  state.hovering ? '' : null,
);
export const GalleryScrollAreaDemo$ScrollArea_data_scrolling_derive = derive(['state'], (state) =>
  state.scrolling ? '' : null,
);
export const GalleryScrollAreaDemo$ScrollAreaViewport_data_has_overflow_y_derive = derive(
  ['state'],
  (state) => (state.hasOverflowY ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaViewport_data_scrolling_derive = derive(
  ['state'],
  (state) => (state.scrolling ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaViewport_data_scroll_y_derive = derive(
  ['state'],
  (state) => state.scrollY,
);
export const GalleryScrollAreaDemo$ScrollAreaViewport_scrollTop_derive = derive(
  ['state'],
  (state) => state.scrollTop,
);
export const GalleryScrollAreaDemo$ScrollAreaViewport_scrollY_derive = derive(
  ['state'],
  (state) => state.scrollY,
);
export const GalleryScrollAreaDemo$ScrollAreaScrollbar_data_has_overflow_y_derive = derive(
  ['state'],
  (state) => (state.hasOverflowY ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaScrollbar_data_hovering_derive = derive(
  ['state'],
  (state) => (state.hovering ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaScrollbar_data_scrolling_derive = derive(
  ['state'],
  (state) => (state.scrolling ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaScrollbar_data_state_derive = derive(
  ['state'],
  (state) =>
    state.verticalVisible && (state.hovering || state.scrolling || state.dragging)
      ? 'visible'
      : 'hidden',
);
export const GalleryScrollAreaDemo$ScrollAreaScrollbar_hidden_derive = derive(['state'], (state) =>
  !(state.verticalVisible && (state.hovering || state.scrolling || state.dragging)) ? '' : null,
);
export const GalleryScrollAreaDemo$ScrollAreaScrollbar_visible_derive = derive(
  ['state'],
  (state) => state.verticalVisible && (state.hovering || state.scrolling || state.dragging),
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_data_dragging_derive = derive(
  ['state'],
  (state) => (state.dragging ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_data_has_overflow_y_derive = derive(
  ['state'],
  (state) => (state.hasOverflowY ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_data_hovering_derive = derive(
  ['state'],
  (state) => (state.hovering ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_data_scrolling_derive = derive(
  ['state'],
  (state) => (state.scrolling ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_data_scroll_position_derive = derive(
  ['state'],
  (state) => state.scrollY,
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_data_state_derive = derive(['state'], (state) =>
  state.verticalVisible && (state.hovering || state.scrolling || state.dragging)
    ? 'visible'
    : 'hidden',
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_hidden_derive = derive(['state'], (state) =>
  !(state.verticalVisible && (state.hovering || state.scrolling || state.dragging)) ? '' : null,
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_style_derive = derive(['state'], (state) =>
  [
    kovoStyleProperty('height', `${state.thumbSize}%`),
    kovoStyleProperty('top', `${state.thumbOffset}%`),
  ]
    .filter(Boolean)
    .join('; '),
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_scrollPosition_derive = derive(
  ['state'],
  (state) => state.scrollY,
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_visible_derive = derive(
  ['state'],
  (state) => state.verticalVisible && (state.hovering || state.scrolling || state.dragging),
);
export const GalleryScrollAreaDemo$button_aria_pressed_derive = derive(['state'], (state) =>
  state.scrollY === 'end' ? 'true' : 'false',
);
export const GalleryScrollAreaDemo$span_text_derive = derive(['state'], (state) =>
  state.scrollY === 'end' ? 'Back to top' : 'Jump to end',
);
