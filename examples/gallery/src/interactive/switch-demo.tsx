/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { Switch, switchTriggerClick as _switchTriggerClick } from '@kovojs/ui/switch';

export interface GallerySwitchDemoState {
  checked: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GallerySwitchDemo = component({
  state: () => ({ checked: false }),
  render: (_queries: Record<string, never>, state: GallerySwitchDemoState) => (
    <Switch
      checked={state.checked}
      data-gallery-interactive="switch"
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
      value="enabled"
    >
      <span class="select-none leading-none">Notifications</span>
      <output class="text-xs text-neutral-500" data-demo-state="checked">
        {state.checked ? 'on' : 'off'}
      </output>
    </Switch>
  ),
});
