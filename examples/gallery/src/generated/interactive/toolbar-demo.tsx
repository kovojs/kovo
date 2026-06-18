// @kovojs-ir - lowered from examples/gallery/src/interactive/toolbar-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryToolbarDemo$button_aria_pressed_derive = derive(['state'], (state: any) =>
  String(state.pressedValue === 'bold'),
);
export const GalleryToolbarDemo$button_data_pressed_derive = derive(['state'], (state: any) =>
  String(state.pressedValue === 'bold'),
);
export const GalleryToolbarDemo$button_tabIndex_derive = derive(['state'], (state: any) =>
  state.activeValue === 'bold' ? 0 : -1,
);
export const GalleryToolbarDemo$button_aria_pressed_derive_2 = derive(['state'], (state: any) =>
  String(state.pressedValue === 'link'),
);
export const GalleryToolbarDemo$button_data_pressed_derive_2 = derive(['state'], (state: any) =>
  String(state.pressedValue === 'link'),
);
export const GalleryToolbarDemo$button_tabIndex_derive_2 = derive(['state'], (state: any) =>
  state.activeValue === 'link' ? 0 : -1,
);
export const GalleryToolbarDemo$output_text_derive = derive(
  ['state'],
  (state: any) => state.pressedValue || 'none',
);

import { component } from '@kovojs/core';
import {
  toolbarButtonAttributes,
  toolbarItemAttributes,
  toolbarRootAttributes,
} from '@kovojs/headless-ui/toolbar';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/toolbar.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const TOOLBAR_CLASS =
  'inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white p-1 text-neutral-950 shadow-sm data-[orientation=vertical]:flex-col data-[disabled]:opacity-50';
const ITEM_CLASS = 'inline-flex data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50';
const BUTTON_CLASS =
  'inline-flex h-8 min-w-8 items-center justify-center rounded px-2.5 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 disabled:pointer-events-none data-[pressed=true]:bg-neutral-950 data-[pressed=true]:text-white data-[pressed=true]:shadow-sm data-[disabled]:opacity-50';

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
        {...toolbarRootAttributes(rootState)}
        class="grid gap-2"
        data-gallery-interactive="toolbar"
        on:keydown="/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js?v=fdbdbc07#GalleryToolbarDemo$div_keydown"
        kovo-c="gallery-toolbar-demo"
        kovo-state='{"activeValue":"bold","pressedValue":"bold"}'
      >
        <div class={TOOLBAR_CLASS}>
          <span {...toolbarItemAttributes(boldState)} class={ITEM_CLASS}>
            <button
              class={BUTTON_CLASS}
              on:click="/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js?v=fdbdbc07#GalleryToolbarDemo$button_click"
              {...toolbarButtonAttributes({
                ...boldState,
                id: 'gallery-toolbar-bold',
                pressed: state.pressedValue === 'bold',
              })}
              aria-pressed={String(state.pressedValue === 'bold')}
              data-bind:aria-pressed="/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js?v=fdbdbc07#GalleryToolbarDemo$button_aria_pressed_derive"
              data-pressed={String(state.pressedValue === 'bold')}
              data-bind:data-pressed="/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js?v=fdbdbc07#GalleryToolbarDemo$button_data_pressed_derive"
              tabIndex={state.activeValue === 'bold' ? 0 : -1}
              data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js?v=fdbdbc07#GalleryToolbarDemo$button_tabIndex_derive"
            >
              Bold
            </button>
          </span>
          <span {...toolbarItemAttributes(italicState)} class={ITEM_CLASS}>
            <button
              {...toolbarButtonAttributes({
                ...italicState,
                id: 'gallery-toolbar-italic',
                pressed: false,
              })}
              class={BUTTON_CLASS}
              tabIndex={-1}
            >
              Italic
            </button>
          </span>
          <span {...toolbarItemAttributes(linkState)} class={ITEM_CLASS}>
            <button
              class={BUTTON_CLASS}
              on:click="/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js?v=fdbdbc07#GalleryToolbarDemo$button_click_2"
              {...toolbarButtonAttributes({
                ...linkState,
                id: 'gallery-toolbar-link',
                pressed: state.pressedValue === 'link',
              })}
              aria-pressed={String(state.pressedValue === 'link')}
              data-bind:aria-pressed="/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js?v=fdbdbc07#GalleryToolbarDemo$button_aria_pressed_derive_2"
              data-pressed={String(state.pressedValue === 'link')}
              data-bind:data-pressed="/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js?v=fdbdbc07#GalleryToolbarDemo$button_data_pressed_derive_2"
              tabIndex={state.activeValue === 'link' ? 0 : -1}
              data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js?v=fdbdbc07#GalleryToolbarDemo$button_tabIndex_derive_2"
            >
              Link
            </button>
          </span>
        </div>
        <output data-demo-state="toolbar-active" data-bind="state.activeValue">
          {state.activeValue}
        </output>
        <output
          data-demo-state="toolbar-pressed"
          data-bind="/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js?v=fdbdbc07#GalleryToolbarDemo$output_text_derive"
        >
          {state.pressedValue || 'none'}
        </output>
      </div>
    );
  },
});
GalleryToolbarDemo.name = 'generated/interactive/toolbar-demo/gallery-toolbar-demo';
