/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import { checkboxRootAttributes, type CheckboxCheckedState } from '@jiso/headless-ui/primitives';

export interface GalleryCheckboxDemoState {
  checked: CheckboxCheckedState;
}

// SPEC.md section 5.2: this source is the authored gallery component; generated
// IR and client modules are checked in only as compiler outputs.
export const GalleryCheckboxDemo = component('gallery-checkbox-demo', {
  state: () => ({ checked: 'indeterminate' }),
  render: (_queries: Record<string, never>, state: GalleryCheckboxDemoState) => {
    const attrs = checkboxRootAttributes({
      checked: state.checked,
      name: 'gallery-email-summary',
      value: 'enabled',
    });

    return (
      <label class="inline-flex items-center gap-2" data-gallery-interactive="checkbox">
        <input
          {...attrs}
          onClick={() => {
            state.checked = state.checked === 'indeterminate' ? true : !state.checked;
          }}
        />
        <span>Email summary</span>
        <output data-demo-state="checked">{String(state.checked)}</output>
      </label>
    );
  },
});
