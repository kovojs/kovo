// @jiso-ir
import { derive, handler } from '@jiso/runtime';

import {
  scrollAreaThumbGeometry as _scrollAreaThumbGeometry,
  scrollAreaViewportScroll as _scrollAreaViewportScroll,
} from '@jiso/headless-ui/primitives';

export const GalleryScrollAreaDemo$div_scroll = handler((event, ctx) => {
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
  ctx.state.verticalVisible = geometry.visible;
});
export const GalleryScrollAreaDemo$button_click = handler((_event, ctx) => {
  const nextAtEnd = ctx.state.scrollY !== 'end';
  ctx.state.scrollTop = nextAtEnd ? 1000000 : 0;
  ctx.state.scrollY = nextAtEnd ? 'end' : 'start';
  ctx.state.thumbOffset = nextAtEnd ? 100 : 0;
});

export const GalleryScrollAreaDemo$div_data_scroll_y_derive = derive(
  ['state'],
  (state) => state.scrollY,
);
export const GalleryScrollAreaDemo$div_scrollTop_derive = derive(
  ['state'],
  (state) => state.scrollTop,
);
export const GalleryScrollAreaDemo$div_data_state_derive = derive(['state'], (state) =>
  state.verticalVisible ? 'visible' : 'hidden',
);
export const GalleryScrollAreaDemo$div_hidden_derive = derive(['state'], (state) =>
  !state.verticalVisible ? '' : null,
);
export const GalleryScrollAreaDemo$span_data_scroll_position_derive = derive(
  ['state'],
  (state) => state.scrollY,
);
export const GalleryScrollAreaDemo$span_data_state_derive = derive(['state'], (state) =>
  state.verticalVisible ? 'visible' : 'hidden',
);
export const GalleryScrollAreaDemo$span_hidden_derive = derive(['state'], (state) =>
  !state.verticalVisible ? '' : null,
);
export const GalleryScrollAreaDemo$span_style_derive = derive(
  ['state'],
  (state) => `height: ${state.thumbSize}%; top: ${state.thumbOffset}%;`,
);
export const GalleryScrollAreaDemo$button_aria_pressed_derive = derive(['state'], (state) =>
  state.scrollY === 'end' ? 'true' : 'false',
);
export const GalleryScrollAreaDemo$span_text_derive = derive(['state'], (state) =>
  state.scrollY === 'end' ? 'Back to top' : 'Jump to end',
);
