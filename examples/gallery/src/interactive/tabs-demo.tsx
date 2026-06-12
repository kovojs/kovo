/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  tabsListAttributes,
  tabsPanelAttributes,
  tabsRootAttributes,
  tabsTriggerAttributes,
} from '@jiso/headless-ui/primitives';

export interface GalleryTabsDemoState {
  value: string;
}

const tabsItems = Object.freeze([{ value: 'overview' }, { value: 'details' }]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryTabsDemo = component('gallery-tabs-demo', {
  state: () => ({ value: 'overview' }),
  render: (_queries: Record<string, never>, state: GalleryTabsDemoState) => {
    const rootState = {
      items: tabsItems,
      value: state.value,
    };

    return (
      <section
        {...tabsRootAttributes(rootState)}
        class="grid gap-2"
        data-gallery-interactive="tabs"
      >
        <div
          {...tabsListAttributes({ ...rootState, label: 'Gallery sections' })}
          onKeyDown={() => {
            state.value = state.value === 'overview' ? 'details' : 'overview';
          }}
        >
          <button
            {...tabsTriggerAttributes({
              ...rootState,
              id: 'gallery-tabs-overview-trigger',
              itemValue: 'overview',
              panelId: 'gallery-tabs-overview-panel',
            })}
            onClick={() => {
              state.value = 'overview';
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
              state.value = 'details';
            }}
          >
            Details
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
      </section>
    );
  },
});
