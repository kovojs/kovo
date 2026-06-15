// @jiso-ir - lowered from examples/gallery/src/interactive/toolbar-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { derive } from '@jiso/runtime';

export const GalleryToolbarDemo$output_text_derive = derive(
  ['state'],
  (state: any) => state.pressedValue || 'none',
);

import { component } from '@jiso/core';
import {
  toolbarButtonAttributes,
  toolbarItemAttributes,
  toolbarRootAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/toolbar.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
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
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryToolbarDemo = component('gallery-toolbar-demo', {
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
        on:keydown="/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js?v=e3de55aa#GalleryToolbarDemo$div_keydown"
        fw-c="gallery-toolbar-demo"
        fw-state='{"activeValue":"bold","pressedValue":"bold"}'
      >
        <div class={TOOLBAR_CLASS}>
          <span {...toolbarItemAttributes(boldState)} class={ITEM_CLASS}>
            <button
              {...toolbarButtonAttributes({
                ...boldState,
                id: 'gallery-toolbar-bold',
                pressed: state.pressedValue === 'bold',
              })}
              class={BUTTON_CLASS}
              on:click="/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js?v=e3de55aa#GalleryToolbarDemo$button_click"
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
            >
              Italic
            </button>
          </span>
          <span {...toolbarItemAttributes(linkState)} class={ITEM_CLASS}>
            <button
              {...toolbarButtonAttributes({
                ...linkState,
                id: 'gallery-toolbar-link',
                pressed: state.pressedValue === 'link',
              })}
              class={BUTTON_CLASS}
              on:click="/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js?v=e3de55aa#GalleryToolbarDemo$button_click_2"
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
          data-bind="/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js?v=e3de55aa#GalleryToolbarDemo$output_text_derive"
        >
          {state.pressedValue || 'none'}
        </output>
      </div>
    );
  },
});
