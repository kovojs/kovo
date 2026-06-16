/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { switchTriggerClick as _switchTriggerClick } from '@kovojs/headless-ui/primitives';

// Tailwind classes mirror the @kovojs/ui styled layer (packages/ui/src/switch.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS =
  'inline-flex items-center gap-2 text-sm text-neutral-950 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50';
const INPUT_CLASS =
  'h-5 w-9 rounded-full border border-neutral-300 bg-neutral-200 accent-neutral-950 transition-colors checked:bg-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50';

export interface GallerySwitchDemoState {
  checked: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GallerySwitchDemo = component('gallery-switch-demo', {
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
