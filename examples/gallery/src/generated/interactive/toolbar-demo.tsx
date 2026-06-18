// @kovojs-ir - lowered from examples/gallery/src/interactive/toolbar-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryToolbarDemo$ToolbarButton_aria_pressed_derive = derive(
  ['state'],
  (state: any) => String(state.pressedValue === 'bold'),
);
export const GalleryToolbarDemo$ToolbarButton_data_pressed_derive = derive(
  ['state'],
  (state: any) => String(state.pressedValue === 'bold'),
);
export const GalleryToolbarDemo$ToolbarButton_pressed_derive = derive(
  ['state'],
  (state: any) => state.pressedValue === 'bold',
);
export const GalleryToolbarDemo$ToolbarButton_tabIndex_derive = derive(['state'], (state: any) =>
  state.activeValue === 'bold' ? 0 : -1,
);
export const GalleryToolbarDemo$ToolbarButton_aria_pressed_derive_2 = derive(
  ['state'],
  (state: any) => String(state.pressedValue === 'link'),
);
export const GalleryToolbarDemo$ToolbarButton_data_pressed_derive_2 = derive(
  ['state'],
  (state: any) => String(state.pressedValue === 'link'),
);
export const GalleryToolbarDemo$ToolbarButton_pressed_derive_2 = derive(
  ['state'],
  (state: any) => state.pressedValue === 'link',
);
export const GalleryToolbarDemo$ToolbarButton_tabIndex_derive_2 = derive(['state'], (state: any) =>
  state.activeValue === 'link' ? 0 : -1,
);
export const GalleryToolbarDemo$output_text_derive = derive(
  ['state'],
  (state: any) => state.pressedValue || 'none',
);

import { component } from '@kovojs/core';
import { Toolbar, ToolbarButton, ToolbarItem } from '@kovojs/ui/toolbar';

export interface GalleryToolbarDemoState {
  activeValue: string;
  pressedValue: string;
}

const toolbarItems = Object.freeze([
  { value: 'bold' },
  { disabled: true, value: 'italic' },
  { value: 'link' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryToolbarDemo = component({
  state: () => ({ activeValue: 'bold', pressedValue: 'bold' }),
  render: (_queries: Record<string, never>, state: GalleryToolbarDemoState) => {
    const rootState = {
      activeValue: state.activeValue,
      items: toolbarItems,
      label: 'Formatting toolbar',
    };
    const boldState = { ...rootState, itemValue: 'bold' };
    const italicState = { ...rootState, itemValue: 'italic' };
    const linkState = { ...rootState, itemValue: 'link' };

    return (
      <div
        class="grid gap-2"
        data-gallery-interactive="toolbar"
        kovo-c="gallery-toolbar-demo"
        kovo-state='{"activeValue":"bold","pressedValue":"bold"}'
      >
        <Toolbar
          {...rootState}
          on:keydown="/c/__v/2e87863c/examples/gallery/src/generated/interactive/toolbar-demo.client.js#GalleryToolbarDemo$Toolbar_keydown"
        >
          <ToolbarItem {...boldState}>
            <ToolbarButton
              id="gallery-toolbar-bold"
              on:click="/c/__v/2e87863c/examples/gallery/src/generated/interactive/toolbar-demo.client.js#GalleryToolbarDemo$ToolbarButton_click"
              {...boldState}
              aria-pressed={String(state.pressedValue === 'bold')}
              data-bind:aria-pressed="/c/__v/2e87863c/examples/gallery/src/generated/interactive/toolbar-demo.client.js#GalleryToolbarDemo$ToolbarButton_aria_pressed_derive"
              data-pressed={String(state.pressedValue === 'bold')}
              data-bind:data-pressed="/c/__v/2e87863c/examples/gallery/src/generated/interactive/toolbar-demo.client.js#GalleryToolbarDemo$ToolbarButton_data_pressed_derive"
              pressed={state.pressedValue === 'bold'}
              data-bind:pressed="/c/__v/2e87863c/examples/gallery/src/generated/interactive/toolbar-demo.client.js#GalleryToolbarDemo$ToolbarButton_pressed_derive"
              tabIndex={state.activeValue === 'bold' ? 0 : -1}
              data-bind:tabIndex="/c/__v/2e87863c/examples/gallery/src/generated/interactive/toolbar-demo.client.js#GalleryToolbarDemo$ToolbarButton_tabIndex_derive"
            >
              Bold
            </ToolbarButton>
          </ToolbarItem>
          <ToolbarItem {...italicState}>
            <ToolbarButton
              {...italicState}
              id="gallery-toolbar-italic"
              pressed={false}
              tabIndex={-1}
            >
              Italic
            </ToolbarButton>
          </ToolbarItem>
          <ToolbarItem {...linkState}>
            <ToolbarButton
              id="gallery-toolbar-link"
              on:click="/c/__v/2e87863c/examples/gallery/src/generated/interactive/toolbar-demo.client.js#GalleryToolbarDemo$ToolbarButton_click_2"
              {...linkState}
              aria-pressed={String(state.pressedValue === 'link')}
              data-bind:aria-pressed="/c/__v/2e87863c/examples/gallery/src/generated/interactive/toolbar-demo.client.js#GalleryToolbarDemo$ToolbarButton_aria_pressed_derive_2"
              data-pressed={String(state.pressedValue === 'link')}
              data-bind:data-pressed="/c/__v/2e87863c/examples/gallery/src/generated/interactive/toolbar-demo.client.js#GalleryToolbarDemo$ToolbarButton_data_pressed_derive_2"
              pressed={state.pressedValue === 'link'}
              data-bind:pressed="/c/__v/2e87863c/examples/gallery/src/generated/interactive/toolbar-demo.client.js#GalleryToolbarDemo$ToolbarButton_pressed_derive_2"
              tabIndex={state.activeValue === 'link' ? 0 : -1}
              data-bind:tabIndex="/c/__v/2e87863c/examples/gallery/src/generated/interactive/toolbar-demo.client.js#GalleryToolbarDemo$ToolbarButton_tabIndex_derive_2"
            >
              Link
            </ToolbarButton>
          </ToolbarItem>
        </Toolbar>
        <output data-demo-state="toolbar-active" data-bind="state.activeValue">
          {state.activeValue}
        </output>
        <output
          data-demo-state="toolbar-pressed"
          data-bind="/c/__v/2e87863c/examples/gallery/src/generated/interactive/toolbar-demo.client.js#GalleryToolbarDemo$output_text_derive"
        >
          {state.pressedValue || 'none'}
        </output>
      </div>
    );
  },
});
GalleryToolbarDemo.name = 'generated/interactive/toolbar-demo/gallery-toolbar-demo';
