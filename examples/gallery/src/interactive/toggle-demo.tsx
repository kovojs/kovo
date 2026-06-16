/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { toggleTriggerClick as _toggleTriggerClick } from '@kovojs/headless-ui/primitives';

// Tailwind classes mirror the @kovojs/ui styled layer (packages/ui/src/toggle.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
// BUTTON_CLASS = toggleClassNames base + the default `outline` variant.
const BUTTON_CLASS =
  'inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=pressed]:bg-neutral-950 data-[state=pressed]:text-white border-neutral-300 bg-white text-neutral-950 shadow-sm hover:bg-neutral-50 focus-visible:outline-neutral-400';

export interface GalleryToggleDemoState {
  pressed: boolean;
}

// SPEC.md section 5.2: this is app-authored TSX. The emitted lowered TSX and
// client module under src/generated/interactive are compiler artifacts.
export const GalleryToggleDemo = component('gallery-toggle-demo', {
  state: () => ({ pressed: false }),
  render: (_queries: Record<string, never>, state: GalleryToggleDemoState) => (
    <section class="grid gap-2 text-sm text-neutral-950" data-gallery-interactive="toggle">
      <button
        aria-label="Toggle gallery density"
        aria-pressed={String(state.pressed)}
        class={BUTTON_CLASS}
        data-state={state.pressed ? 'pressed' : 'off'}
        onClick={() => {
          const result = _toggleTriggerClick(Object(event), { pressed: state.pressed });
          if (!result) return;
          state.pressed = result.pressed;
        }}
        type="button"
      >
        Dense rows
      </button>
      <output class="text-xs text-neutral-500" data-demo-state="pressed">
        {state.pressed ? 'pressed' : 'off'}
      </output>
    </section>
  ),
});
