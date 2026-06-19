/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  tabsKeyDown as _tabsKeyDown,
  tabsTriggerClick as _tabsTriggerClick,
} from '@kovojs/headless-ui/tabs';
import { Tabs, TabsList, TabsPanel, TabsTrigger } from '@kovojs/ui/tabs';

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
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryTabsDemo = component({
  state: () => ({ activeValue: 'overview', value: 'overview' }),
  render: (_queries: Record<string, never>, state: GalleryTabsDemoState) => {
    const rootState = {
      activationMode: 'manual' as const,
      activeValue: state.activeValue,
      items: tabsItems,
      value: state.value,
    };

    return (
      <Tabs
        {...rootState}
        data-gallery-interactive="tabs"
        onKeyDown={() => {
          const result = _tabsKeyDown(Object(event), {
            activationMode: 'manual',
            activeValue: state.activeValue,
            items: [
              { value: 'overview' },
              { disabled: true, value: 'audit' },
              { value: 'details' },
            ],
            value: state.value,
          });
          if (!result) return;
          state.activeValue = result.activeValue ?? state.activeValue;
          state.value = result.value ?? state.value;
        }}
      >
        <TabsList {...rootState} label="Gallery sections">
          <TabsTrigger
            {...rootState}
            aria-selected={String(state.value === 'overview')}
            data-state={state.value === 'overview' ? 'active' : 'inactive'}
            id="gallery-tabs-overview-trigger"
            itemValue="overview"
            onClick={() => {
              const result = _tabsTriggerClick(Object(event), {
                itemValue: 'overview',
                value: state.value,
              });
              if (!result) return;
              state.activeValue = result.value ?? state.activeValue;
              state.value = result.value ?? state.value;
            }}
            panelId="gallery-tabs-overview-panel"
            tabIndex={state.activeValue === 'overview' ? 0 : -1}
          >
            Overview
          </TabsTrigger>
          <TabsTrigger
            {...rootState}
            aria-selected={String(state.value === 'details')}
            data-state={state.value === 'details' ? 'active' : 'inactive'}
            id="gallery-tabs-details-trigger"
            itemValue="details"
            onClick={() => {
              const result = _tabsTriggerClick(Object(event), {
                itemValue: 'details',
                value: state.value,
              });
              if (!result) return;
              state.activeValue = result.value ?? state.activeValue;
              state.value = result.value ?? state.value;
            }}
            panelId="gallery-tabs-details-panel"
            tabIndex={state.activeValue === 'details' ? 0 : -1}
          >
            Details
          </TabsTrigger>
          <TabsTrigger
            {...rootState}
            aria-selected={String(state.value === 'audit')}
            data-state={state.value === 'audit' ? 'active' : 'inactive'}
            id="gallery-tabs-audit-trigger"
            itemDisabled={true}
            itemValue="audit"
            panelId="gallery-tabs-audit-panel"
            tabIndex={-1}
          >
            Audit
          </TabsTrigger>
        </TabsList>
        <TabsPanel
          {...rootState}
          data-state={state.value === 'overview' ? 'active' : 'inactive'}
          hidden={state.value !== 'overview'}
          id="gallery-tabs-overview-panel"
          itemValue="overview"
          tabIndex={state.value === 'overview' ? 0 : undefined}
          triggerId="gallery-tabs-overview-trigger"
        >
          Summary metrics stay visible without client runtime.
        </TabsPanel>
        <TabsPanel
          {...rootState}
          data-state={state.value === 'details' ? 'active' : 'inactive'}
          hidden={state.value !== 'details'}
          id="gallery-tabs-details-panel"
          itemValue="details"
          tabIndex={state.value === 'details' ? 0 : undefined}
          triggerId="gallery-tabs-details-trigger"
        >
          Detailed notes are selected by click or arrow-key activation.
        </TabsPanel>
        <TabsPanel
          {...rootState}
          data-state={state.value === 'audit' ? 'active' : 'inactive'}
          hidden={state.value !== 'audit'}
          id="gallery-tabs-audit-panel"
          itemValue="audit"
          tabIndex={state.value === 'audit' ? 0 : undefined}
          triggerId="gallery-tabs-audit-trigger"
        >
          Disabled audit notes stay out of the roving keyboard path.
        </TabsPanel>
      </Tabs>
    );
  },
});
