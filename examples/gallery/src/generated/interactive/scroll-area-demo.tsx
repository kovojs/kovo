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
        class="grid gap-2"
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
        >
          <span
            {...scrollAreaThumbAttributes({
              ...rootState,
              id: 'gallery-scroll-area-thumb',
              orientation: 'vertical',
              scrollPosition: scrollY,
              visible: true,
            })}
          />
        </div>
        <div
          {...scrollAreaCornerAttributes({
            ...rootState,
            id: 'gallery-scroll-area-corner',
            visible: false,
          })}
        />
        <button
          aria-controls={viewportId}
          aria-pressed={String(atEnd)}
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
