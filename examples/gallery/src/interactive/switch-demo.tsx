/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { switchTriggerClick as _switchTriggerClick } from '@kovojs/headless-ui/switch';
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
      <span style="user-select:none;line-height:1">Notifications</span>
      <output
        style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
        data-demo-state="checked"
      >
        {state.checked ? 'on' : 'off'}
      </output>
    </Switch>
  ),
});
