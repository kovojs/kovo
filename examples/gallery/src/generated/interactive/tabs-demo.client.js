// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryTabsDemo$section_keydown = handler((_event, ctx) => {
  if (ctx.state.activeValue === 'overview') {
    ctx.state.activeValue = 'details';
  } else {
    ctx.state.value = ctx.state.activeValue;
  }
  const doc = Reflect['get'](globalThis, 'document');
  const overview = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tabs-overview-trigger')
    : undefined;
  const details = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tabs-details-trigger')
    : undefined;
  const audit = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tabs-audit-trigger')
    : undefined;
  const overviewPanel = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tabs-overview-panel')
    : undefined;
  const detailsPanel = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tabs-details-panel')
    : undefined;
  const auditPanel = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tabs-audit-panel')
    : undefined;

  if (overview) {
    overview['tabIndex'] = ctx.state.activeValue === 'overview' ? 0 : -1;
    Object(overview)['setAttribute']?.call(
      overview,
      'aria-selected',
      ctx.state.value === 'overview' ? 'true' : 'false',
    );
    Object(overview)['setAttribute']?.call(
      overview,
      'data-state',
      ctx.state.value === 'overview' ? 'active' : 'inactive',
    );
  }
  if (details) {
    details['tabIndex'] = ctx.state.activeValue === 'details' ? 0 : -1;
    Object(details)['setAttribute']?.call(
      details,
      'aria-selected',
      ctx.state.value === 'details' ? 'true' : 'false',
    );
    Object(details)['setAttribute']?.call(
      details,
      'data-state',
      ctx.state.value === 'details' ? 'active' : 'inactive',
    );
  }
  if (audit) {
    audit['tabIndex'] = -1;
    Object(audit)['setAttribute']?.call(
      audit,
      'aria-selected',
      ctx.state.value === 'audit' ? 'true' : 'false',
    );
    Object(audit)['setAttribute']?.call(
      audit,
      'data-state',
      ctx.state.value === 'audit' ? 'active' : 'inactive',
    );
  }
  if (overviewPanel) {
    overviewPanel['hidden'] = ctx.state.value !== 'overview';
    Object(overviewPanel)['setAttribute']?.call(
      overviewPanel,
      'data-state',
      ctx.state.value === 'overview' ? 'active' : 'inactive',
    );
  }
  if (detailsPanel) {
    detailsPanel['hidden'] = ctx.state.value !== 'details';
    Object(detailsPanel)['setAttribute']?.call(
      detailsPanel,
      'data-state',
      ctx.state.value === 'details' ? 'active' : 'inactive',
    );
  }
  if (auditPanel) {
    auditPanel['hidden'] = ctx.state.value !== 'audit';
    Object(auditPanel)['setAttribute']?.call(
      auditPanel,
      'data-state',
      ctx.state.value === 'audit' ? 'active' : 'inactive',
    );
  }
});
export const GalleryTabsDemo$button_click = handler((_event, ctx) => {
  ctx.state.activeValue = 'overview';
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
export const GalleryTabsDemo$button_click_2 = handler((_event, ctx) => {
  ctx.state.activeValue = 'details';
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
