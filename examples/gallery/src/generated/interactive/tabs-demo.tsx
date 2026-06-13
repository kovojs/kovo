// @jiso-ir - lowered from examples/gallery/src/interactive/tabs-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
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
        on:keydown="/c/examples/gallery/src/generated/interactive/tabs-demo.client.js?v=6eb82670#GalleryTabsDemo$section_keydown"
        fw-c="gallery-tabs-demo"
        fw-state='{"activeValue":"overview","value":"overview"}'
      >
        <div {...tabsListAttributes({ ...rootState, label: 'Gallery sections' })}>
          <button
            {...tabsTriggerAttributes({
              ...rootState,
              id: 'gallery-tabs-overview-trigger',
              itemValue: 'overview',
              panelId: 'gallery-tabs-overview-panel',
            })}
            on:click="/c/examples/gallery/src/generated/interactive/tabs-demo.client.js?v=6eb82670#GalleryTabsDemo$button_click"
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
            on:click="/c/examples/gallery/src/generated/interactive/tabs-demo.client.js?v=6eb82670#GalleryTabsDemo$button_click_2"
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
