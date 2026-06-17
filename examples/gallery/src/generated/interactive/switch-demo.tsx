// @kovojs-ir - lowered from examples/gallery/src/interactive/switch-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GallerySwitchDemo$input_aria_checked_derive = derive(['state'], (state: any) =>
  String(state.checked),
);
export const GallerySwitchDemo$input_checked_derive = derive(['state'], (state: any) =>
  state.checked ? '' : null,
);
export const GallerySwitchDemo$input_data_state_derive = derive(['state'], (state: any) =>
  state.checked ? 'checked' : 'unchecked',
);
export const GallerySwitchDemo$output_text_derive = derive(['state'], (state: any) =>
  state.checked ? 'on' : 'off',
);

import { component } from '@kovojs/core';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/switch.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const ROOT_CLASS =
  'inline-flex items-center gap-2 text-sm text-neutral-950 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50';
const INPUT_CLASS =
  'h-5 w-9 rounded-full border border-neutral-300 bg-neutral-200 accent-neutral-950 transition-colors checked:bg-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50';

export interface GallerySwitchDemoState {
  checked: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GallerySwitchDemo = component({
  state: () => ({ checked: false }),
  render: (_queries: Record<string, never>, state: GallerySwitchDemoState) => (
    <label
      class={ROOT_CLASS}
      data-gallery-interactive="switch"
      kovo-c="gallery-switch-demo"
      kovo-state='{"checked":false}'
    >
      <input
        class={INPUT_CLASS}
        form="gallery-switch-form"
        name="gallery-notifications"
        on:click="/c/examples/gallery/src/generated/interactive/switch-demo.client.js?v=52de2f07#GallerySwitchDemo$input_click"
        on:keydown="/c/examples/gallery/src/generated/interactive/switch-demo.client.js?v=52de2f07#GallerySwitchDemo$input_keydown"
        role="switch"
        type="checkbox"
        value="enabled"
        aria-checked={String(state.checked)}
        data-bind:aria-checked="/c/examples/gallery/src/generated/interactive/switch-demo.client.js?v=52de2f07#GallerySwitchDemo$input_aria_checked_derive"
        checked={state.checked}
        data-bind:checked="/c/examples/gallery/src/generated/interactive/switch-demo.client.js?v=52de2f07#GallerySwitchDemo$input_checked_derive"
        data-state={state.checked ? 'checked' : 'unchecked'}
        data-bind:data-state="/c/examples/gallery/src/generated/interactive/switch-demo.client.js?v=52de2f07#GallerySwitchDemo$input_data_state_derive"
      />
      <span class="select-none leading-none">Notifications</span>
      <output
        class="text-xs text-neutral-500"
        data-demo-state="checked"
        data-bind="/c/examples/gallery/src/generated/interactive/switch-demo.client.js?v=52de2f07#GallerySwitchDemo$output_text_derive"
      >
        {state.checked ? 'on' : 'off'}
      </output>
    </label>
  ),
});
GallerySwitchDemo.name = 'generated/interactive/switch-demo/gallery-switch-demo';
