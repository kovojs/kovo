// @kovojs-ir - lowered from examples/gallery/src/interactive/tabs-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryTabsDemo$button_aria_selected_derive = derive(['state'], (state: any) =>
  String(state.value === 'overview'),
);
export const GalleryTabsDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.value === 'overview' ? 'active' : 'inactive',
);
export const GalleryTabsDemo$button_tabIndex_derive = derive(['state'], (state: any) =>
  state.activeValue === 'overview' ? 0 : -1,
);
export const GalleryTabsDemo$button_aria_selected_derive_2 = derive(['state'], (state: any) =>
  String(state.value === 'details'),
);
export const GalleryTabsDemo$button_data_state_derive_2 = derive(['state'], (state: any) =>
  state.value === 'details' ? 'active' : 'inactive',
);
export const GalleryTabsDemo$button_tabIndex_derive_2 = derive(['state'], (state: any) =>
  state.activeValue === 'details' ? 0 : -1,
);
export const GalleryTabsDemo$button_aria_selected_derive_3 = derive(['state'], (state: any) =>
  String(state.value === 'audit'),
);
export const GalleryTabsDemo$button_data_state_derive_3 = derive(['state'], (state: any) =>
  state.value === 'audit' ? 'active' : 'inactive',
);
export const GalleryTabsDemo$section_data_state_derive = derive(['state'], (state: any) =>
  state.value === 'overview' ? 'active' : 'inactive',
);
export const GalleryTabsDemo$section_hidden_derive = derive(['state'], (state: any) =>
  state.value !== 'overview' ? '' : null,
);
export const GalleryTabsDemo$section_tabIndex_derive = derive(['state'], (state: any) =>
  state.value === 'overview' ? 0 : undefined,
);
export const GalleryTabsDemo$section_data_state_derive_2 = derive(['state'], (state: any) =>
  state.value === 'details' ? 'active' : 'inactive',
);
export const GalleryTabsDemo$section_hidden_derive_2 = derive(['state'], (state: any) =>
  state.value !== 'details' ? '' : null,
);
export const GalleryTabsDemo$section_tabIndex_derive_2 = derive(['state'], (state: any) =>
  state.value === 'details' ? 0 : undefined,
);
export const GalleryTabsDemo$section_data_state_derive_3 = derive(['state'], (state: any) =>
  state.value === 'audit' ? 'active' : 'inactive',
);
export const GalleryTabsDemo$section_hidden_derive_3 = derive(['state'], (state: any) =>
  state.value !== 'audit' ? '' : null,
);
export const GalleryTabsDemo$section_tabIndex_derive_3 = derive(['state'], (state: any) =>
  state.value === 'audit' ? 0 : undefined,
);

import { component } from '@kovojs/core';
import {
  tabsListAttributes,
  tabsPanelAttributes,
  tabsRootAttributes,
  tabsTriggerAttributes,
} from '@kovojs/headless-ui/tabs';
import {
  tabsClasses,
  tabsListClasses,
  tabsTriggerClasses,
  tabsPanelClasses,
} from '@kovojs/ui/tabs';

const ROOT_CLASS = tabsClasses.join(' ');
const LIST_CLASS = tabsListClasses.join(' ');
const TRIGGER_CLASS = tabsTriggerClasses.join(' ');
const PANEL_CLASS = tabsPanelClasses.join(' ');

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
      <section
        {...tabsRootAttributes(rootState)}
        class={ROOT_CLASS}
        data-gallery-interactive="tabs"
        on:keydown="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$section_keydown"
        kovo-c="gallery-tabs-demo"
        kovo-state='{"activeValue":"overview","value":"overview"}'
      >
        <div
          {...tabsListAttributes({ ...rootState, label: 'Gallery sections' })}
          class={LIST_CLASS}
        >
          <button
            class={TRIGGER_CLASS}
            on:click="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$button_click"
            {...tabsTriggerAttributes({
              ...rootState,
              id: 'gallery-tabs-overview-trigger',
              itemValue: 'overview',
              panelId: 'gallery-tabs-overview-panel',
            })}
            aria-selected={String(state.value === 'overview')}
            data-bind:aria-selected="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$button_aria_selected_derive"
            data-state={state.value === 'overview' ? 'active' : 'inactive'}
            data-bind:data-state="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$button_data_state_derive"
            tabIndex={state.activeValue === 'overview' ? 0 : -1}
            data-bind:tabIndex="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$button_tabIndex_derive"
          >
            Overview
          </button>
          <button
            class={TRIGGER_CLASS}
            on:click="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$button_click_2"
            {...tabsTriggerAttributes({
              ...rootState,
              id: 'gallery-tabs-details-trigger',
              itemValue: 'details',
              panelId: 'gallery-tabs-details-panel',
            })}
            aria-selected={String(state.value === 'details')}
            data-bind:aria-selected="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$button_aria_selected_derive_2"
            data-state={state.value === 'details' ? 'active' : 'inactive'}
            data-bind:data-state="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$button_data_state_derive_2"
            tabIndex={state.activeValue === 'details' ? 0 : -1}
            data-bind:tabIndex="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$button_tabIndex_derive_2"
          >
            Details
          </button>
          <button
            class={TRIGGER_CLASS}
            tabIndex={-1}
            {...tabsTriggerAttributes({
              ...rootState,
              id: 'gallery-tabs-audit-trigger',
              itemValue: 'audit',
              panelId: 'gallery-tabs-audit-panel',
            })}
            aria-selected={String(state.value === 'audit')}
            data-bind:aria-selected="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$button_aria_selected_derive_3"
            data-state={state.value === 'audit' ? 'active' : 'inactive'}
            data-bind:data-state="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$button_data_state_derive_3"
          >
            Audit
          </button>
        </div>
        <section
          class={PANEL_CLASS}
          {...tabsPanelAttributes({
            ...rootState,
            id: 'gallery-tabs-overview-panel',
            itemValue: 'overview',
            triggerId: 'gallery-tabs-overview-trigger',
          })}
          data-state={state.value === 'overview' ? 'active' : 'inactive'}
          data-bind:data-state="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$section_data_state_derive"
          hidden={state.value !== 'overview'}
          data-bind:hidden="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$section_hidden_derive"
          tabIndex={state.value === 'overview' ? 0 : undefined}
          data-bind:tabIndex="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$section_tabIndex_derive"
        >
          Summary metrics stay visible without client runtime.
        </section>
        <section
          class={PANEL_CLASS}
          {...tabsPanelAttributes({
            ...rootState,
            id: 'gallery-tabs-details-panel',
            itemValue: 'details',
            triggerId: 'gallery-tabs-details-trigger',
          })}
          data-state={state.value === 'details' ? 'active' : 'inactive'}
          data-bind:data-state="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$section_data_state_derive_2"
          hidden={state.value !== 'details'}
          data-bind:hidden="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$section_hidden_derive_2"
          tabIndex={state.value === 'details' ? 0 : undefined}
          data-bind:tabIndex="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$section_tabIndex_derive_2"
        >
          Detailed notes are selected by click or arrow-key activation.
        </section>
        <section
          class={PANEL_CLASS}
          {...tabsPanelAttributes({
            ...rootState,
            id: 'gallery-tabs-audit-panel',
            itemValue: 'audit',
            triggerId: 'gallery-tabs-audit-trigger',
          })}
          data-state={state.value === 'audit' ? 'active' : 'inactive'}
          data-bind:data-state="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$section_data_state_derive_3"
          hidden={state.value !== 'audit'}
          data-bind:hidden="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$section_hidden_derive_3"
          tabIndex={state.value === 'audit' ? 0 : undefined}
          data-bind:tabIndex="/c/__v/b73dd019/examples/gallery/src/generated/interactive/tabs-demo.client.js#GalleryTabsDemo$section_tabIndex_derive_3"
        >
          Disabled audit notes stay out of the roving keyboard path.
        </section>
      </section>
    );
  },
});
GalleryTabsDemo.name = 'generated/interactive/tabs-demo/gallery-tabs-demo';
