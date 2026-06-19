// @kovojs-ir - lowered from examples/gallery/src/interactive/toggle-group-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryToggleGroupDemo$ToggleGroupButton_aria_pressed_derive = derive(
  ['state'],
  (state: any) => String(state.value === 'bold' || state.value === 'bold,italic'),
);
export const GalleryToggleGroupDemo$ToggleGroupButton_data_state_derive = derive(
  ['state'],
  (state: any) => (state.value === 'bold' || state.value === 'bold,italic' ? 'pressed' : 'off'),
);
export const GalleryToggleGroupDemo$ToggleGroupButton_tabIndex_derive = derive(
  ['state'],
  (state: any) => (state.activeValue === 'bold' ? 0 : -1),
);
export const GalleryToggleGroupDemo$ToggleGroupButton_aria_pressed_derive_2 = derive(
  ['state'],
  (state: any) => String(state.value === 'italic' || state.value === 'bold,italic'),
);
export const GalleryToggleGroupDemo$ToggleGroupButton_data_state_derive_2 = derive(
  ['state'],
  (state: any) => (state.value === 'italic' || state.value === 'bold,italic' ? 'pressed' : 'off'),
);
export const GalleryToggleGroupDemo$ToggleGroupButton_tabIndex_derive_2 = derive(
  ['state'],
  (state: any) => (state.activeValue === 'italic' ? 0 : -1),
);
export const GalleryToggleGroupDemo$output_text_derive = derive(
  ['state'],
  (state: any) => state.value || 'none',
);

import { component } from '@kovojs/core';
import { ToggleGroup, ToggleGroupButton, ToggleGroupItem } from '@kovojs/ui/toggle-group';

export interface GalleryToggleGroupDemoState {
  activeValue: string;
  value: string;
}

const toggleItems = Object.freeze([
  { value: 'bold' },
  { disabled: true, value: 'strike' },
  { value: 'italic' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryToggleGroupDemo = component({
  state: () => ({ activeValue: 'bold', value: 'bold' }),
  render: (_queries: Record<string, never>, state: GalleryToggleGroupDemoState) => {
    const selectedValues =
      state.value === 'bold,italic' ? ['bold', 'italic'] : state.value === '' ? [] : [state.value];
    const groupState = {
      activeValue: state.activeValue,
      items: toggleItems,
      type: 'multiple' as const,
      value: selectedValues,
    };
    const boldState = { ...groupState, itemValue: 'bold' };
    const strikeState = { ...groupState, itemValue: 'strike' };
    const italicState = { ...groupState, itemValue: 'italic' };

    return (
      <section
        style="display:grid;gap:0.5rem;font-size:0.875rem;color:#0a0a0a"
        data-gallery-interactive="toggle-group"
        kovo-c="gallery-toggle-group-demo"
        kovo-state='{"activeValue":"bold","value":"bold"}'
      >
        <h3 id="gallery-toggle-group-label" style="font-size:0.875rem;font-weight:500">
          Text style
        </h3>
        <ToggleGroup
          {...groupState}
          labelledBy="gallery-toggle-group-label"
          on:keydown="/c/__v/4bfbdc35/examples/gallery/src/generated/interactive/toggle-group-demo.client.js#GalleryToggleGroupDemo$ToggleGroup_keydown"
        >
          <ToggleGroupItem {...boldState}>
            <ToggleGroupButton
              id="gallery-toggle-group-bold"
              on:click="/c/__v/4bfbdc35/examples/gallery/src/generated/interactive/toggle-group-demo.client.js#GalleryToggleGroupDemo$ToggleGroupButton_click"
              {...boldState}
              aria-pressed={String(state.value === 'bold' || state.value === 'bold,italic')}
              data-bind:aria-pressed="/c/__v/4bfbdc35/examples/gallery/src/generated/interactive/toggle-group-demo.client.js#GalleryToggleGroupDemo$ToggleGroupButton_aria_pressed_derive"
              data-state={
                state.value === 'bold' || state.value === 'bold,italic' ? 'pressed' : 'off'
              }
              data-bind:data-state="/c/__v/4bfbdc35/examples/gallery/src/generated/interactive/toggle-group-demo.client.js#GalleryToggleGroupDemo$ToggleGroupButton_data_state_derive"
              tabIndex={state.activeValue === 'bold' ? 0 : -1}
              data-bind:tabIndex="/c/__v/4bfbdc35/examples/gallery/src/generated/interactive/toggle-group-demo.client.js#GalleryToggleGroupDemo$ToggleGroupButton_tabIndex_derive"
            >
              Bold
            </ToggleGroupButton>
          </ToggleGroupItem>
          <ToggleGroupItem {...strikeState}>
            <ToggleGroupButton
              {...strikeState}
              data-state="off"
              id="gallery-toggle-group-strike"
              itemDisabled={true}
              tabIndex={-1}
            >
              Strike
            </ToggleGroupButton>
          </ToggleGroupItem>
          <ToggleGroupItem {...italicState}>
            <ToggleGroupButton
              id="gallery-toggle-group-italic"
              on:click="/c/__v/4bfbdc35/examples/gallery/src/generated/interactive/toggle-group-demo.client.js#GalleryToggleGroupDemo$ToggleGroupButton_click_2"
              {...italicState}
              aria-pressed={String(state.value === 'italic' || state.value === 'bold,italic')}
              data-bind:aria-pressed="/c/__v/4bfbdc35/examples/gallery/src/generated/interactive/toggle-group-demo.client.js#GalleryToggleGroupDemo$ToggleGroupButton_aria_pressed_derive_2"
              data-state={
                state.value === 'italic' || state.value === 'bold,italic' ? 'pressed' : 'off'
              }
              data-bind:data-state="/c/__v/4bfbdc35/examples/gallery/src/generated/interactive/toggle-group-demo.client.js#GalleryToggleGroupDemo$ToggleGroupButton_data_state_derive_2"
              tabIndex={state.activeValue === 'italic' ? 0 : -1}
              data-bind:tabIndex="/c/__v/4bfbdc35/examples/gallery/src/generated/interactive/toggle-group-demo.client.js#GalleryToggleGroupDemo$ToggleGroupButton_tabIndex_derive_2"
            >
              Italic
            </ToggleGroupButton>
          </ToggleGroupItem>
        </ToggleGroup>
        <output
          style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
          data-demo-state="toggle-group-value"
          data-bind="/c/__v/4bfbdc35/examples/gallery/src/generated/interactive/toggle-group-demo.client.js#GalleryToggleGroupDemo$output_text_derive"
        >
          {state.value || 'none'}
        </output>
      </section>
    );
  },
});
GalleryToggleGroupDemo.name = 'generated/interactive/toggle-group-demo/gallery-toggle-group-demo';
