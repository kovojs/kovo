// @kovojs-ir - lowered from examples/gallery/src/interactive/toggle-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryToggleDemo$Toggle_pressed_derive = derive(
  ['state'],
  (state: any) => state.pressed,
);
export const GalleryToggleDemo$output_text_derive = derive(['state'], (state: any) =>
  state.pressed ? 'pressed' : 'off',
);

import { component } from '@kovojs/core';
import { Toggle } from '@kovojs/ui/toggle';

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
      <Toggle
        aria-label="Toggle gallery density"
        on:click="/c/__v/92a9effd/examples/gallery/src/generated/interactive/toggle-demo.client.js#GalleryToggleDemo$Toggle_click"
        pressed={state.pressed}
        data-bind:pressed="/c/__v/92a9effd/examples/gallery/src/generated/interactive/toggle-demo.client.js#GalleryToggleDemo$Toggle_pressed_derive"
      >
        Dense rows
      </Toggle>
      <output
        class="text-xs text-neutral-500"
        data-demo-state="pressed"
        data-bind="/c/__v/92a9effd/examples/gallery/src/generated/interactive/toggle-demo.client.js#GalleryToggleDemo$output_text_derive"
      >
        {state.pressed ? 'pressed' : 'off'}
      </output>
    </section>
  ),
});
GalleryToggleDemo.name = 'generated/interactive/toggle-demo/gallery-toggle-demo';
