// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryMenubarDemo$section_keydown = handler((event, ctx) => {
  ctx.state.activeValue = 'edit';
  const doc = Reflect['get'](globalThis, 'document');
  const file = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-menubar-file') : undefined;
  const edit = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-menubar-edit') : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="menubar-active"]')
    : undefined;
  if (file) file['tabIndex'] = -1;
  if (edit) edit['tabIndex'] = 0;
  if (output) output['textContent'] = 'edit';
});
export const GalleryMenubarDemo$button_click = handler((event, ctx) => {
  ctx.state.activeValue = 'file';
  ctx.state.openValue = ctx.state.openValue === 'file' ? '' : 'file';
  const doc = Reflect['get'](globalThis, 'document');
  const file = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-menubar-file') : undefined;
  const menu = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-menubar-file-menu')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="menubar-open"]')
    : undefined;
  if (file)
    Object(file)['setAttribute']?.call(
      file,
      'aria-expanded',
      String(ctx.state.openValue === 'file'),
    );
  if (menu) menu['hidden'] = ctx.state.openValue !== 'file';
  if (output) output['textContent'] = ctx.state.openValue || 'none';
});
export const GalleryMenubarDemo$button_click_2 = handler((event, ctx) => {
  ctx.state.openValue = '';
  ctx.state.value = 'new';
  const doc = Reflect['get'](globalThis, 'document');
  const menu = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-menubar-file-menu')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="menubar-value"]')
    : undefined;
  if (menu) menu['hidden'] = true;
  if (output) output['textContent'] = 'new';
});
