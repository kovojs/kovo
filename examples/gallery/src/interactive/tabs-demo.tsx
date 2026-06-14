/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  tabsListAttributes,
  tabsPanelAttributes,
  tabsRootAttributes,
  tabsTriggerAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/tabs.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS = 'w-full text-neutral-950 data-[disabled]:opacity-50';
const LIST_CLASS =
  'inline-flex h-10 items-center gap-1 rounded-md border border-neutral-200 bg-neutral-100 p-1 data-[orientation=vertical]:h-auto data-[orientation=vertical]:flex-col data-[disabled]:opacity-50';
const TRIGGER_CLASS =
  'inline-flex h-8 items-center justify-center rounded px-3 text-sm font-medium text-neutral-600 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 disabled:pointer-events-none data-[state=active]:bg-white data-[state=active]:text-neutral-950 data-[state=active]:shadow-sm data-[disabled]:opacity-50';
const PANEL_CLASS =
  'mt-3 rounded-md border border-neutral-200 bg-white p-4 text-sm text-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400';

export interface GalleryTabsDemoState {
  activeValue: string;
  value: string;
}

const tabsItems = Object.freeze([
  { value: 'overview' },
  { disabled: true, value: 'audit' },
  { value: 'details' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryTabsDemo = component('gallery-tabs-demo', {
  state: () => ({ activeValue: 'overview', value: 'overview' }),
  render: (_queries: Record<string, never>, state: GalleryTabsDemoState) => {
    const rootState = {
      activationMode: 'manual' as const,
      activeValue: state.activeValue,
      items: tabsItems,
      value: state.value,
    };

    return (
      <section
        {...tabsRootAttributes(rootState)}
        class={ROOT_CLASS}
        data-gallery-interactive="tabs"
        onKeyDown={() => {
          if (state.activeValue === 'overview') {
            state.activeValue = 'details';
          } else {
            state.value = state.activeValue;
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
            overview['tabIndex'] = state.activeValue === 'overview' ? 0 : -1;
            Object(overview)['setAttribute']?.call(
              overview,
              'aria-selected',
              state.value === 'overview' ? 'true' : 'false',
            );
            Object(overview)['setAttribute']?.call(
              overview,
              'data-state',
              state.value === 'overview' ? 'active' : 'inactive',
            );
          }
          if (details) {
            details['tabIndex'] = state.activeValue === 'details' ? 0 : -1;
            Object(details)['setAttribute']?.call(
              details,
              'aria-selected',
              state.value === 'details' ? 'true' : 'false',
            );
            Object(details)['setAttribute']?.call(
              details,
              'data-state',
              state.value === 'details' ? 'active' : 'inactive',
            );
          }
          if (audit) {
            audit['tabIndex'] = -1;
            Object(audit)['setAttribute']?.call(
              audit,
              'aria-selected',
              state.value === 'audit' ? 'true' : 'false',
            );
            Object(audit)['setAttribute']?.call(
              audit,
              'data-state',
              state.value === 'audit' ? 'active' : 'inactive',
            );
          }
          if (overviewPanel) {
            overviewPanel['hidden'] = state.value !== 'overview';
            Object(overviewPanel)['setAttribute']?.call(
              overviewPanel,
              'data-state',
              state.value === 'overview' ? 'active' : 'inactive',
            );
          }
          if (detailsPanel) {
            detailsPanel['hidden'] = state.value !== 'details';
            Object(detailsPanel)['setAttribute']?.call(
              detailsPanel,
              'data-state',
              state.value === 'details' ? 'active' : 'inactive',
            );
          }
          if (auditPanel) {
            auditPanel['hidden'] = state.value !== 'audit';
            Object(auditPanel)['setAttribute']?.call(
              auditPanel,
              'data-state',
              state.value === 'audit' ? 'active' : 'inactive',
            );
          }
        }}
      >
        <div {...tabsListAttributes({ ...rootState, label: 'Gallery sections' })} class={LIST_CLASS}>
          <button
            {...tabsTriggerAttributes({
              ...rootState,
              id: 'gallery-tabs-overview-trigger',
              itemValue: 'overview',
              panelId: 'gallery-tabs-overview-panel',
            })}
            class={TRIGGER_CLASS}
            onClick={() => {
              state.activeValue = 'overview';
              state.value = 'overview';
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
            }}
          >
            Overview
          </button>
          <button
            {...tabsTriggerAttributes({
              ...rootState,
              id: 'gallery-tabs-details-trigger',
              itemValue: 'details',
              panelId: 'gallery-tabs-details-panel',
            })}
            class={TRIGGER_CLASS}
            onClick={() => {
              state.activeValue = 'details';
              state.value = 'details';
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
                Object(overviewPanel)['setAttribute']?.call(
                  overviewPanel,
                  'data-state',
                  'inactive',
                );
              }
              if (detailsPanel) {
                detailsPanel['hidden'] = false;
                Object(detailsPanel)['setAttribute']?.call(detailsPanel, 'data-state', 'active');
              }
            }}
          >
            Details
          </button>
          <button
            {...tabsTriggerAttributes({
              ...rootState,
              id: 'gallery-tabs-audit-trigger',
              itemValue: 'audit',
              panelId: 'gallery-tabs-audit-panel',
            })}
            class={TRIGGER_CLASS}
          >
            Audit
          </button>
        </div>
        <section
          {...tabsPanelAttributes({
            ...rootState,
            id: 'gallery-tabs-overview-panel',
            itemValue: 'overview',
            triggerId: 'gallery-tabs-overview-trigger',
          })}
          class={PANEL_CLASS}
        >
          Summary metrics stay visible without client runtime.
        </section>
        <section
          {...tabsPanelAttributes({
            ...rootState,
            id: 'gallery-tabs-details-panel',
            itemValue: 'details',
            triggerId: 'gallery-tabs-details-trigger',
          })}
          class={PANEL_CLASS}
        >
          Detailed notes are selected by click or arrow-key activation.
        </section>
        <section
          {...tabsPanelAttributes({
            ...rootState,
            id: 'gallery-tabs-audit-panel',
            itemValue: 'audit',
            triggerId: 'gallery-tabs-audit-trigger',
          })}
          class={PANEL_CLASS}
        >
          Disabled audit notes stay out of the roving keyboard path.
        </section>
      </section>
    );
  },
});
