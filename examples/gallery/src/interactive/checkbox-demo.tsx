/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  checkboxTriggerClick as _checkboxTriggerClick,
  type CheckboxCheckedState,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/checkbox.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS =
  'inline-flex items-center gap-2 text-sm text-neutral-950 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50';
const INPUT_CLASS =
  'h-4 w-4 rounded border border-neutral-300 text-neutral-950 accent-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50';

export interface GalleryCheckboxDemoState {
  checked: CheckboxCheckedState;
}

// SPEC.md section 5.2: this source is the authored gallery component; generated
// IR and client modules are checked in only as compiler outputs.
export const GalleryCheckboxDemo = component('gallery-checkbox-demo', {
  state: () => ({ checked: 'indeterminate' }),
  render: (_queries: Record<string, never>, state: GalleryCheckboxDemoState) => (
    <label class={ROOT_CLASS} data-gallery-interactive="checkbox">
      <input
        aria-checked={state.checked === 'indeterminate' ? 'mixed' : String(state.checked)}
        checked={state.checked === true}
        class={INPUT_CLASS}
        data-state={
          state.checked === 'indeterminate'
            ? 'indeterminate'
            : state.checked
              ? 'checked'
              : 'unchecked'
        }
        indeterminate={state.checked === 'indeterminate'}
        name="gallery-email-summary"
        onClick={() => {
          const result = _checkboxTriggerClick(Object(event), { checked: state.checked });
          if (!result) return;
          state.checked = result.checked;
        }}
        type="checkbox"
        value="enabled"
      />
      <span class="select-none leading-none">Email summary</span>
      <output class="text-xs text-neutral-500" data-demo-state="checked">
        {String(state.checked)}
      </output>
    </label>
  ),
});
