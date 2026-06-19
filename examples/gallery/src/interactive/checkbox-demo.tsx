/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  checkboxTriggerClick as _checkboxTriggerClick,
  type CheckboxCheckedState,
} from '@kovojs/headless-ui/checkbox';
import { Checkbox } from '@kovojs/ui/checkbox';

export interface GalleryCheckboxDemoState {
  checked: CheckboxCheckedState;
}

// SPEC.md section 5.2: this source is the authored gallery component; generated
// IR and client modules are checked in only as compiler outputs.
export const GalleryCheckboxDemo = component({
  state: () => ({ checked: 'indeterminate' }),
  render: (_queries: Record<string, never>, state: GalleryCheckboxDemoState) => (
    <Checkbox
      checked={state.checked}
      data-gallery-interactive="checkbox"
      name="gallery-email-summary"
      onClick={() => {
        const result = _checkboxTriggerClick(Object(event), { checked: state.checked });
        if (!result) return;
        state.checked = result.checked;
      }}
      value="enabled"
    >
      <span style="user-select:none;line-height:1">Email summary</span>
      <output
        style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
        data-demo-state="checked"
      >
        {String(state.checked)}
      </output>
    </Checkbox>
  ),
});
