// @jiso-ir - lowered from examples/gallery/src/interactive/toggle-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import { toggleRootAttributes } from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/toggle.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
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
  render: (_queries: Record<string, never>, state: GalleryToggleDemoState) => {
    const attrs = toggleRootAttributes({ pressed: state.pressed });

    return (
      <section
        class="grid gap-2 text-sm text-neutral-950"
        data-gallery-interactive="toggle"
        fw-c="gallery-toggle-demo"
        fw-state='{"pressed":false}'
      >
        <button
          {...attrs}
          aria-label="Toggle gallery density"
          class={BUTTON_CLASS}
          on:click="/c/examples/gallery/src/generated/interactive/toggle-demo.client.js?v=359e44f6#GalleryToggleDemo$button_click"
        >
          Dense rows
        </button>
        <output class="text-xs text-neutral-500" data-demo-state="pressed">
          {state.pressed ? 'pressed' : 'off'}
        </output>
      </section>
    );
  },
});
