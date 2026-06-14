// @jiso-ir - lowered from examples/gallery/src/interactive/scroll-area-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  scrollAreaCornerAttributes,
  scrollAreaRootAttributes,
  scrollAreaScrollbarAttributes,
  scrollAreaThumbAttributes,
  scrollAreaViewportAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/scroll-area.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
// The viewport keeps its inline max-height/overflow style so the demo stays short
// enough to scroll; that inline style wins over the @jiso/ui max-h-56 utility.
// TOGGLE_CLASS uses the @jiso/ui button base (packages/ui/src/button.tsx) since the
// jump-to-end control has no scroll-area counterpart.
const ROOT_CLASS =
  'relative overflow-hidden rounded-md border border-neutral-200 bg-white text-sm text-neutral-950 data-[disabled]:opacity-50';
const VIEWPORT_CLASS =
  'max-h-56 overflow-auto p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-950 data-[disabled]:cursor-not-allowed';
const SCROLLBAR_CLASS =
  'absolute flex touch-none select-none bg-neutral-100 p-0.5 transition-colors data-[orientation=vertical]:inset-y-0 data-[orientation=vertical]:right-0 data-[orientation=vertical]:w-2.5 data-[orientation=horizontal]:inset-x-0 data-[orientation=horizontal]:bottom-0 data-[orientation=horizontal]:h-2.5 data-[state=hidden]:opacity-0';
const THUMB_CLASS =
  'relative flex-1 rounded-full bg-neutral-400 data-[orientation=vertical]:min-h-8 data-[orientation=horizontal]:min-w-8 data-[state=hidden]:opacity-0';
const CORNER_CLASS =
  'absolute bottom-0 right-0 h-2.5 w-2.5 bg-neutral-100 data-[state=hidden]:hidden';
const TOGGLE_CLASS =
  'inline-flex h-9 w-fit items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 disabled:pointer-events-none disabled:opacity-50';

export interface GalleryScrollAreaDemoState {
  position: 'end' | 'top';
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryScrollAreaDemo = component('gallery-scroll-area-demo', {
  state: () => ({ position: 'top' }),
  render: (_queries: Record<string, never>, state: GalleryScrollAreaDemoState) => {
    const rootState = { scrollbars: 'vertical' as const };
    const viewportId = 'gallery-scroll-area-viewport';
    const atEnd = state.position === 'end';
    const scrollY = state.position === 'top' ? 'start' : 'end';

    return (
      <section
        {...scrollAreaRootAttributes({ ...rootState, id: 'gallery-scroll-area-root' })}
        class={ROOT_CLASS}
        data-gallery-interactive="scroll-area"
        fw-c="gallery-scroll-area-demo"
        fw-state='{"position":"top"}'
      >
        <div
          {...scrollAreaViewportAttributes({
            ...rootState,
            id: viewportId,
            label: 'Release notes',
            scrollY,
          })}
          class={VIEWPORT_CLASS}
          style="max-height: 72px; overflow: auto;"
        >
          <div style="min-height: 260px;">
            <p>Framework primitives keep native scrolling in charge.</p>
            <p>Scrollbars expose stable data attributes for styled wrappers.</p>
            <p>Browser coverage checks focusability, labels, and live scroll position.</p>
            <p>Generated handlers can coordinate visible state without authoring lowered IR.</p>
          </div>
        </div>
        <div
          {...scrollAreaScrollbarAttributes({
            ...rootState,
            id: 'gallery-scroll-area-scrollbar',
            orientation: 'vertical',
            visible: true,
          })}
          class={SCROLLBAR_CLASS}
        >
          <span
            {...scrollAreaThumbAttributes({
              ...rootState,
              id: 'gallery-scroll-area-thumb',
              orientation: 'vertical',
              scrollPosition: scrollY,
              visible: true,
            })}
            class={THUMB_CLASS}
          />
        </div>
        <div
          {...scrollAreaCornerAttributes({
            ...rootState,
            id: 'gallery-scroll-area-corner',
            visible: false,
          })}
          class={CORNER_CLASS}
        />
        <button
          aria-controls={viewportId}
          aria-pressed={String(atEnd)}
          class={TOGGLE_CLASS}
          id="gallery-scroll-area-toggle"
          on:click="/c/examples/gallery/src/generated/interactive/scroll-area-demo.client.js?v=f3ce9203#GalleryScrollAreaDemo$button_click"
        >
          {atEnd ? 'Back to top' : 'Jump to end'}
        </button>
        <output data-demo-state="scroll-area-position">{state.position}</output>
      </section>
    );
  },
});
