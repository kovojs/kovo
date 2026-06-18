// @kovojs-ir - lowered from examples/gallery/src/interactive/toggle-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryToggleDemo$button_aria_pressed_derive = derive(['state'], (state: any) =>
  String(state.pressed),
);
export const GalleryToggleDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.pressed ? 'pressed' : 'off',
);
export const GalleryToggleDemo$output_text_derive = derive(['state'], (state: any) =>
  state.pressed ? 'pressed' : 'off',
);

import { component } from '@kovojs/core';
import { toggleClasses } from '@kovojs/ui/toggle';

const BUTTON_CLASS = toggleClasses[0];

export interface GalleryToggleDemoState {
  pressed: boolean;
}

// SPEC.md section 5.2: this is app-authored TSX. The emitted lowered TSX and
// client module under src/generated/interactive are compiler artifacts.
export const GalleryToggleDemo = component({
  state: () => ({ pressed: false }),
  render: (_queries: Record<string, never>, state: GalleryToggleDemoState) => (
    <section
      class="grid gap-2 text-sm text-neutral-950"
      data-gallery-interactive="toggle"
      kovo-c="gallery-toggle-demo"
      kovo-state='{"pressed":false}'
    >
      <button
        aria-label="Toggle gallery density"
        class={BUTTON_CLASS}
        on:click="/c/__v/47a0f901/examples/gallery/src/generated/interactive/toggle-demo.client.js#GalleryToggleDemo$button_click"
        type="button"
        aria-pressed={String(state.pressed)}
        data-bind:aria-pressed="/c/__v/47a0f901/examples/gallery/src/generated/interactive/toggle-demo.client.js#GalleryToggleDemo$button_aria_pressed_derive"
        data-state={state.pressed ? 'pressed' : 'off'}
        data-bind:data-state="/c/__v/47a0f901/examples/gallery/src/generated/interactive/toggle-demo.client.js#GalleryToggleDemo$button_data_state_derive"
      >
        Dense rows
      </button>
      <output
        class="text-xs text-neutral-500"
        data-demo-state="pressed"
        data-bind="/c/__v/47a0f901/examples/gallery/src/generated/interactive/toggle-demo.client.js#GalleryToggleDemo$output_text_derive"
      >
        {state.pressed ? 'pressed' : 'off'}
      </output>
    </section>
  ),
});
GalleryToggleDemo.name = 'generated/interactive/toggle-demo/gallery-toggle-demo';
