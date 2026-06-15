// @jiso-ir
import { derive, handler } from '@jiso/runtime';

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
export const GalleryMenubarDemo$button_keydown = handler((event, ctx) => {
  if (
    event &&
    Object(event)['key'] !== 'Enter' &&
    Object(event)['key'] !== ' ' &&
    Object(event)['key'] !== 'Spacebar'
  )
    return;

  if (event) Object(event)['preventDefault']?.call(event);
  ctx.state.openValue = '';
  ctx.state.value = 'new';
  const doc = Reflect['get'](globalThis, 'document');
  const file = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-menubar-file') : undefined;
  const menu = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-menubar-file-menu')
    : undefined;
  const openOutput = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="menubar-open"]')
    : undefined;
  const valueOutput = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="menubar-value"]')
    : undefined;
  if (file) Object(file)['setAttribute']?.call(file, 'aria-expanded', 'false');
  if (menu) menu['hidden'] = true;
  if (openOutput) openOutput['textContent'] = 'none';
  if (valueOutput) valueOutput['textContent'] = 'new';
});
export const GalleryMenubarDemo$button_click_2 = handler((event, ctx) => {
  ctx.state.openValue = '';
  ctx.state.value = 'new';
  const doc = Reflect['get'](globalThis, 'document');
  const file = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-menubar-file') : undefined;
  const menu = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-menubar-file-menu')
    : undefined;
  const openOutput = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="menubar-open"]')
    : undefined;
  const valueOutput = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="menubar-value"]')
    : undefined;
  if (file) Object(file)['setAttribute']?.call(file, 'aria-expanded', 'false');
  if (menu) menu['hidden'] = true;
  if (openOutput) openOutput['textContent'] = 'none';
  if (valueOutput) valueOutput['textContent'] = 'new';
});

export const GalleryMenubarDemo$output_text_derive = derive(
  ['state'],
  (state) => state.openValue || 'none',
);
