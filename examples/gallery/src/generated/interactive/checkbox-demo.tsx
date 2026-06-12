// @jiso-ir - lowered from examples/gallery/src/interactive/checkbox-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
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
      <label
        class="inline-flex items-center gap-2"
        data-gallery-interactive="checkbox"
        fw-c="gallery-checkbox-demo"
        fw-state='{"checked":"indeterminate"}'
      >
        <input
          {...attrs}
          on:click="/c/examples/gallery/src/generated/interactive/checkbox-demo.client.js?v=3872a063#GalleryCheckboxDemo$input_click"
        />
        <span>Email summary</span>
        <output data-demo-state="checked">{String(state.checked)}</output>
      </label>
    );
  },
});
