// @jiso-ir - lowered from examples/gallery/src/interactive/toggle-group-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  toggleGroupButtonAttributes,
  toggleGroupItemAttributes,
  toggleGroupRootAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/toggle-group.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const GROUP_CLASS =
  'inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-100 p-1 text-neutral-950 data-[orientation=vertical]:flex-col data-[disabled]:opacity-50';
const ITEM_CLASS = 'inline-flex data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50';
const BUTTON_CLASS =
  'inline-flex h-8 min-w-8 items-center justify-center rounded px-2.5 text-sm font-medium text-neutral-600 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 disabled:pointer-events-none data-[state=pressed]:bg-white data-[state=pressed]:text-neutral-950 data-[state=pressed]:shadow-sm data-[disabled]:opacity-50';

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
    const strikeState = { ...groupState, itemValue: 'strike' };
    const italicState = { ...groupState, itemValue: 'italic' };

    return (
      <section
        {...toggleGroupRootAttributes({
          ...groupState,
          labelledBy: 'gallery-toggle-group-label',
        })}
        class="grid gap-2 text-sm text-neutral-950"
        data-gallery-interactive="toggle-group"
        on:keydown="/c/examples/gallery/src/generated/interactive/toggle-group-demo.client.js?v=fc92efe7#GalleryToggleGroupDemo$section_keydown"
        fw-c="gallery-toggle-group-demo"
        fw-state='{"activeValue":"bold","value":"bold"}'
      >
        <h3 id="gallery-toggle-group-label" class="text-sm font-medium">
          Text style
        </h3>
        <div class={GROUP_CLASS}>
          <span {...toggleGroupItemAttributes(boldState)} class={ITEM_CLASS}>
            <button
              {...toggleGroupButtonAttributes({
                ...boldState,
                id: 'gallery-toggle-group-bold',
              })}
              class={BUTTON_CLASS}
              on:click="/c/examples/gallery/src/generated/interactive/toggle-group-demo.client.js?v=fc92efe7#GalleryToggleGroupDemo$button_click"
            >
              Bold
            </button>
          </span>
          <span {...toggleGroupItemAttributes(strikeState)} class={ITEM_CLASS}>
            <button
              {...toggleGroupButtonAttributes({
                ...strikeState,
                id: 'gallery-toggle-group-strike',
              })}
              class={BUTTON_CLASS}
            >
              Strike
            </button>
          </span>
          <span {...toggleGroupItemAttributes(italicState)} class={ITEM_CLASS}>
            <button
              {...toggleGroupButtonAttributes({
                ...italicState,
                id: 'gallery-toggle-group-italic',
              })}
              class={BUTTON_CLASS}
              on:click="/c/examples/gallery/src/generated/interactive/toggle-group-demo.client.js?v=fc92efe7#GalleryToggleGroupDemo$button_click_2"
            >
              Italic
            </button>
          </span>
        </div>
        <output class="text-xs text-neutral-500" data-demo-state="toggle-group-value">
          {state.value || 'none'}
        </output>
      </section>
    );
  },
});
