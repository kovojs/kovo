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

    return (
      <section
        {...scrollAreaRootAttributes({ ...rootState, id: 'gallery-scroll-area-root' })}
        class="grid gap-2"
        data-gallery-interactive="scroll-area"
      >
        <div
          {...scrollAreaViewportAttributes({
            ...rootState,
            id: viewportId,
            label: 'Release notes',
          })}
          data-scroll-position={state.position}
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
              visible: true,
            })}
            data-scroll-position={state.position}
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
          onClick={() => {
            state.position = state.position === 'top' ? 'end' : 'top';
            const nextAtEnd = state.position === 'end';
            const doc = Reflect['get'](globalThis, 'document');
            const viewport = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-scroll-area-viewport')
              : undefined;
            const thumb = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-scroll-area-thumb')
              : undefined;
            const button = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-scroll-area-toggle')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="scroll-area-position"]')
              : undefined;
            const scrollTop = state.position === 'end' ? 160 : 0;

            if (viewport) {
              viewport['scrollTop'] = scrollTop;
              Object(viewport)['setAttribute']?.call(
                viewport,
                'data-scroll-position',
                state.position,
              );
            }
            if (thumb) {
              Object(thumb)['setAttribute']?.call(thumb, 'data-scroll-position', state.position);
            }
            if (button) {
              Object(button)['setAttribute']?.call(button, 'aria-pressed', String(nextAtEnd));
              button['textContent'] = nextAtEnd ? 'Back to top' : 'Jump to end';
            }
            if (output) output['textContent'] = state.position;
          }}
        >
          {atEnd ? 'Back to top' : 'Jump to end'}
        </button>
        <output data-demo-state="scroll-area-position">{state.position}</output>
      </section>
    );
  },
});
