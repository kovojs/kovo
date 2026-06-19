// @kovojs-ir - lowered from examples/gallery/src/interactive/switch-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GallerySwitchDemo$Switch_checked_derive = derive(['state'], (state: any) =>
  state.checked ? '' : null,
);
export const GallerySwitchDemo$Switch_aria_checked_derive = derive(['state'], (state: any) =>
  state.checked ? 'true' : 'false',
);
export const GallerySwitchDemo$Switch_data_state_derive = derive(['state'], (state: any) =>
  state.checked ? 'checked' : 'unchecked',
);
export const GallerySwitchDemo$output_text_derive = derive(['state'], (state: any) =>
  state.checked ? 'on' : 'off',
);

import { component } from '@kovojs/core';
import { Switch } from '@kovojs/ui/switch';

export interface GallerySwitchDemoState {
  checked: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GallerySwitchDemo = component({
  state: () => ({ checked: false }),
  render: (_queries: Record<string, never>, state: GallerySwitchDemoState) => (
    <Switch
      data-gallery-interactive="switch"
      form="gallery-switch-form"
      name="gallery-notifications"
      on:click="/c/__v/44ed888b/examples/gallery/src/generated/interactive/switch-demo.client.js#GallerySwitchDemo$Switch_click"
      on:keydown="/c/__v/44ed888b/examples/gallery/src/generated/interactive/switch-demo.client.js#GallerySwitchDemo$Switch_keydown"
      value="enabled"
      checked={state.checked}
      data-bind:checked="/c/__v/44ed888b/examples/gallery/src/generated/interactive/switch-demo.client.js#GallerySwitchDemo$Switch_checked_derive"
      data-bind:aria-checked="/c/__v/44ed888b/examples/gallery/src/generated/interactive/switch-demo.client.js#GallerySwitchDemo$Switch_aria_checked_derive"
      data-bind:data-state="/c/__v/44ed888b/examples/gallery/src/generated/interactive/switch-demo.client.js#GallerySwitchDemo$Switch_data_state_derive"
      kovo-state='{"checked":false}'
    >
      <span style="user-select:none;line-height:1">Notifications</span>
      <output
        style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
        data-demo-state="checked"
        data-bind="/c/__v/44ed888b/examples/gallery/src/generated/interactive/switch-demo.client.js#GallerySwitchDemo$output_text_derive"
      >
        {state.checked ? 'on' : 'off'}
      </output>
    </Switch>
  ),
});
GallerySwitchDemo.name = 'generated/interactive/switch-demo/gallery-switch-demo';
