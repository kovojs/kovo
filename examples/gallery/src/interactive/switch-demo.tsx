/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { switchTriggerClick as _switchTriggerClick } from '@kovojs/headless-ui/switch';
import {
  switchClasses,
  switchInputClasses,
} from '@kovojs/ui/switch';

const ROOT_CLASS = switchClasses.join(' ');
const INPUT_CLASS = switchInputClasses.join(' ');

export interface GallerySwitchDemoState {
  checked: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GallerySwitchDemo = component({
  state: () => ({ checked: false }),
  render: (_queries: Record<string, never>, state: GallerySwitchDemoState) => (
    <label class={ROOT_CLASS} data-gallery-interactive="switch">
      <input
        aria-checked={String(state.checked)}
        checked={state.checked}
        class={INPUT_CLASS}
        data-state={state.checked ? 'checked' : 'unchecked'}
        form="gallery-switch-form"
        name="gallery-notifications"
        onClick={() => {
          const result = _switchTriggerClick(Object(event), { checked: state.checked });
          if (!result) return;
          state.checked = result.checked;
        }}
        onKeyDown={() => {
          if (Object(event)['key'] !== 'Enter') return;
          const result = _switchTriggerClick(Object(event), { checked: state.checked });
          if (!result) return;
          Object(event)['preventDefault']?.call(event);
          state.checked = result.checked;
        }}
        role="switch"
        type="checkbox"
        value="enabled"
      />
      <span class="select-none leading-none">Notifications</span>
      <output class="text-xs text-neutral-500" data-demo-state="checked">
        {state.checked ? 'on' : 'off'}
      </output>
    </label>
  ),
});
