// @jiso-ir - lowered from examples/gallery/src/interactive/switch-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import { switchRootAttributes } from '@jiso/headless-ui/primitives';

export interface GallerySwitchDemoState {
  checked: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GallerySwitchDemo = component('gallery-switch-demo', {
  state: () => ({ checked: false }),
  render: (_queries: Record<string, never>, state: GallerySwitchDemoState) => {
    const attrs = switchRootAttributes({
      checked: state.checked,
      form: 'gallery-switch-form',
      name: 'gallery-notifications',
      value: 'enabled',
    });

    return (
      <label
        class="inline-flex items-center gap-2"
        data-gallery-interactive="switch"
        fw-c="gallery-switch-demo"
        fw-state='{"checked":false}'
      >
        <input
          {...attrs}
          on:click="/c/examples/gallery/src/generated/interactive/switch-demo.client.js?v=fb75c5e0#GallerySwitchDemo$input_click"
        />
        <span>Notifications</span>
        <output data-demo-state="checked">{state.checked ? 'on' : 'off'}</output>
      </label>
    );
  },
});
