// @jiso-ir - lowered from examples/gallery/src/interactive/toggle-group-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  toggleGroupButtonAttributes,
  toggleGroupItemAttributes,
  toggleGroupRootAttributes,
} from '@jiso/headless-ui/primitives';

export interface GalleryToggleGroupDemoState {
  activeValue: string;
  value: string;
}

const toggleItems = Object.freeze([{ value: 'bold' }, { value: 'italic' }]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryToggleGroupDemo = component('gallery-toggle-group-demo', {
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
    const italicState = { ...groupState, itemValue: 'italic' };

    return (
      <section
        {...toggleGroupRootAttributes({
          ...groupState,
          labelledBy: 'gallery-toggle-group-label',
        })}
        class="grid gap-2"
        data-gallery-interactive="toggle-group"
        on:keydown="/c/examples/gallery/src/generated/interactive/toggle-group-demo.client.js?v=cf7bea09#GalleryToggleGroupDemo$section_keydown"
        fw-c="gallery-toggle-group-demo"
        fw-state='{"activeValue":"bold","value":"bold"}'
      >
        <h3 id="gallery-toggle-group-label">Text style</h3>
        <div class="inline-flex gap-1">
          <span {...toggleGroupItemAttributes(boldState)}>
            <button
              {...toggleGroupButtonAttributes({
                ...boldState,
                id: 'gallery-toggle-group-bold',
              })}
              on:click="/c/examples/gallery/src/generated/interactive/toggle-group-demo.client.js?v=cf7bea09#GalleryToggleGroupDemo$button_click"
            >
              Bold
            </button>
          </span>
          <span {...toggleGroupItemAttributes(italicState)}>
            <button
              {...toggleGroupButtonAttributes({
                ...italicState,
                id: 'gallery-toggle-group-italic',
              })}
              on:click="/c/examples/gallery/src/generated/interactive/toggle-group-demo.client.js?v=cf7bea09#GalleryToggleGroupDemo$button_click_2"
            >
              Italic
            </button>
          </span>
        </div>
        <output data-demo-state="toggle-group-value">{state.value || 'none'}</output>
      </section>
    );
  },
});
