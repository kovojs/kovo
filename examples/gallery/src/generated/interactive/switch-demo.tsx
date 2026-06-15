// @jiso-ir - lowered from examples/gallery/src/interactive/switch-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { derive } from '@jiso/runtime';

export const GallerySwitchDemo$input_aria_checked_derive = derive(['state'], (state) =>
  String(state.checked),
);
export const GallerySwitchDemo$input_checked_derive = derive(['state'], (state) =>
  state.checked ? '' : null,
);
export const GallerySwitchDemo$input_data_state_derive = derive(['state'], (state) =>
  state.checked ? 'checked' : 'unchecked',
);
export const GallerySwitchDemo$output_text_derive = derive(['state'], (state) =>
  state.checked ? 'on' : 'off',
);

import { component } from '@jiso/core';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/switch.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS =
  'inline-flex items-center gap-2 text-sm text-neutral-950 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50';
const INPUT_CLASS =
  'h-5 w-9 rounded-full border border-neutral-300 bg-neutral-200 accent-neutral-950 transition-colors checked:bg-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50';

export interface GallerySwitchDemoState {
  checked: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GallerySwitchDemo = component('gallery-switch-demo', {
  state: () => ({ checked: false }),
  render: (_queries: Record<string, never>, state: GallerySwitchDemoState) => (
    <label
      class={ROOT_CLASS}
      data-gallery-interactive="switch"
      fw-c="gallery-switch-demo"
      fw-state='{"checked":false}'
    >
      <input
        data-bind:aria-checked="/c/examples/gallery/src/generated/interactive/switch-demo.client.js?v=4c353ea0#GallerySwitchDemo$input_aria_checked_derive"
        data-bind:checked="/c/examples/gallery/src/generated/interactive/switch-demo.client.js?v=4c353ea0#GallerySwitchDemo$input_checked_derive"
        class={INPUT_CLASS}
        data-bind:data-state="/c/examples/gallery/src/generated/interactive/switch-demo.client.js?v=4c353ea0#GallerySwitchDemo$input_data_state_derive"
        form="gallery-switch-form"
        name="gallery-notifications"
        on:click="/c/examples/gallery/src/generated/interactive/switch-demo.client.js?v=4c353ea0#GallerySwitchDemo$input_click"
        role="switch"
        type="checkbox"
        value="enabled"
      />
      <span class="select-none leading-none">Notifications</span>
      <output
        class="text-xs text-neutral-500"
        data-demo-state="checked"
        data-bind="/c/examples/gallery/src/generated/interactive/switch-demo.client.js?v=4c353ea0#GallerySwitchDemo$output_text_derive"
      >
        {state.checked ? 'on' : 'off'}
      </output>
    </label>
  ),
});
