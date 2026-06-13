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
      <label class="inline-flex items-center gap-2" data-gallery-interactive="switch">
        <input
          {...attrs}
          onClick={() => {
            state.checked = !state.checked;
          }}
        />
        <span>Notifications</span>
        <output data-demo-state="checked">{state.checked ? 'on' : 'off'}</output>
      </label>
    );
  },
});
