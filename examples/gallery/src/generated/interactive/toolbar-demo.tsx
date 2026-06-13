// @jiso-ir - lowered from examples/gallery/src/interactive/toolbar-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  toolbarButtonAttributes,
  toolbarItemAttributes,
  toolbarRootAttributes,
} from '@jiso/headless-ui/primitives';

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
      <section
        {...toolbarRootAttributes(rootState)}
        class="grid gap-2"
        data-gallery-interactive="toolbar"
        on:keydown="/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js?v=63f8460e#GalleryToolbarDemo$section_keydown"
        fw-c="gallery-toolbar-demo"
        fw-state='{"activeValue":"bold","pressedValue":"bold"}'
      >
        <div class="inline-flex gap-1">
          <span {...toolbarItemAttributes(boldState)}>
            <button
              {...toolbarButtonAttributes({
                ...boldState,
                id: 'gallery-toolbar-bold',
                pressed: state.pressedValue === 'bold',
              })}
              on:click="/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js?v=63f8460e#GalleryToolbarDemo$button_click"
            >
              Bold
            </button>
          </span>
          <span {...toolbarItemAttributes(italicState)}>
            <button
              {...toolbarButtonAttributes({
                ...italicState,
                id: 'gallery-toolbar-italic',
                pressed: false,
              })}
            >
              Italic
            </button>
          </span>
          <span {...toolbarItemAttributes(linkState)}>
            <button
              {...toolbarButtonAttributes({
                ...linkState,
                id: 'gallery-toolbar-link',
                pressed: state.pressedValue === 'link',
              })}
              on:click="/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js?v=63f8460e#GalleryToolbarDemo$button_click_2"
            >
              Link
            </button>
          </span>
        </div>
        <output data-demo-state="toolbar-active">{state.activeValue}</output>
        <output data-demo-state="toolbar-pressed">{state.pressedValue || 'none'}</output>
      </section>
    );
  },
});
