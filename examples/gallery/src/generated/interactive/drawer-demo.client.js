// @jiso-ir
import { derive, handler } from '@jiso/runtime';

export const GalleryDrawerDemo$section_keydown = handler((_event, ctx) => {
  ctx.state.open = false;
});
export const GalleryDrawerDemo$button_click = handler((_event, ctx) => {
  ctx.state.open = true;
});
export const GalleryDrawerDemo$dialog_cancel = handler((_event, ctx) => {
  ctx.state.open = false;
});
export const GalleryDrawerDemo$button_click_2 = handler((_event, ctx) => {
  ctx.state.open = false;
});

export const GalleryDrawerDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
