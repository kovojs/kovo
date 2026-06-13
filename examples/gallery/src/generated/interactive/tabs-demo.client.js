// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryTabsDemo$div_keydown = handler((event, ctx) => {
  ctx.state.value = ctx.state.value === 'overview' ? 'details' : 'overview';
});
export const GalleryTabsDemo$button_click = handler((event, ctx) => {
  ctx.state.value = 'overview';
  const doc = Reflect['get'](globalThis, 'document');
  const overview = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tabs-overview-trigger')
    : undefined;
  const details = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tabs-details-trigger')
    : undefined;
  const overviewPanel = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tabs-overview-panel')
    : undefined;
  const detailsPanel = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tabs-details-panel')
    : undefined;

  if (overview) {
    overview['tabIndex'] = 0;
    Object(overview)['setAttribute']?.call(overview, 'aria-selected', 'true');
    Object(overview)['setAttribute']?.call(overview, 'data-state', 'active');
  }
  if (details) {
    details['tabIndex'] = -1;
    Object(details)['setAttribute']?.call(details, 'aria-selected', 'false');
    Object(details)['setAttribute']?.call(details, 'data-state', 'inactive');
  }
  if (overviewPanel) {
    overviewPanel['hidden'] = false;
    Object(overviewPanel)['setAttribute']?.call(overviewPanel, 'data-state', 'active');
  }
  if (detailsPanel) {
    detailsPanel['hidden'] = true;
    Object(detailsPanel)['setAttribute']?.call(detailsPanel, 'data-state', 'inactive');
  }
});
export const GalleryTabsDemo$button_click_2 = handler((event, ctx) => {
  ctx.state.value = 'details';
  const doc = Reflect['get'](globalThis, 'document');
  const overview = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tabs-overview-trigger')
    : undefined;
  const details = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tabs-details-trigger')
    : undefined;
  const overviewPanel = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tabs-overview-panel')
    : undefined;
  const detailsPanel = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tabs-details-panel')
    : undefined;

  if (overview) {
    overview['tabIndex'] = -1;
    Object(overview)['setAttribute']?.call(overview, 'aria-selected', 'false');
    Object(overview)['setAttribute']?.call(overview, 'data-state', 'inactive');
  }
  if (details) {
    details['tabIndex'] = 0;
    Object(details)['setAttribute']?.call(details, 'aria-selected', 'true');
    Object(details)['setAttribute']?.call(details, 'data-state', 'active');
  }
  if (overviewPanel) {
    overviewPanel['hidden'] = true;
    Object(overviewPanel)['setAttribute']?.call(overviewPanel, 'data-state', 'inactive');
  }
  if (detailsPanel) {
    detailsPanel['hidden'] = false;
    Object(detailsPanel)['setAttribute']?.call(detailsPanel, 'data-state', 'active');
  }
});
