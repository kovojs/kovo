// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryTabsDemo$div_keydown = handler((event, ctx) => {
  ctx.state.value = ctx.state.value === 'overview' ? 'details' : 'overview';
});
export const GalleryTabsDemo$button_click = handler((event, ctx) => {
  ctx.state.value = 'overview';
});
export const GalleryTabsDemo$button_click_2 = handler((event, ctx) => {
  ctx.state.value = 'details';
});
