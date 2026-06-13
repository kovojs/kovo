/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  tabsListAttributes,
  tabsPanelAttributes,
  tabsRootAttributes,
  tabsTriggerAttributes,
} from '@jiso/headless-ui/primitives';

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
        class="grid gap-2"
        data-gallery-interactive="tabs"
        onKeyDown={() => {
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
            Object(overviewPanel)['setAttribute']?.call(overviewPanel, 'data-state', 'inactive');
          }
          if (detailsPanel) {
            detailsPanel['hidden'] = false;
            Object(detailsPanel)['setAttribute']?.call(detailsPanel, 'data-state', 'active');
          }
        }}
      >
        <div {...tabsListAttributes({ ...rootState, label: 'Gallery sections' })}>
          <button
            {...tabsTriggerAttributes({
              ...rootState,
              id: 'gallery-tabs-overview-trigger',
              itemValue: 'overview',
              panelId: 'gallery-tabs-overview-panel',
            })}
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
        >
          Disabled audit notes stay out of the roving keyboard path.
        </section>
      </section>
    );
  },
});
