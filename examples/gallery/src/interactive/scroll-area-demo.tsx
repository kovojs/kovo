/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  scrollAreaCornerAttributes,
  scrollAreaRootAttributes,
  scrollAreaScrollbarAttributes,
  scrollAreaThumbAttributes,
  scrollAreaThumbDrag as _scrollAreaThumbDrag,
  scrollAreaThumbDragStart as _scrollAreaThumbDragStart,
  scrollAreaThumbGeometry as _scrollAreaThumbGeometry,
  scrollAreaTrackPointerDown as _scrollAreaTrackPointerDown,
  scrollAreaViewportAttributes,
  scrollAreaViewportScroll as _scrollAreaViewportScroll,
} from '@kovojs/headless-ui/primitives';

// Tailwind classes mirror the @kovojs/ui styled layer (packages/ui/src/scroll-area.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
// The viewport keeps its inline max-height/overflow style so the demo stays short
// enough to scroll; that inline style wins over the @kovojs/ui max-h-56 utility.
// TOGGLE_CLASS uses the @kovojs/ui button base (packages/ui/src/button.tsx) since the
// jump-to-end control has no scroll-area counterpart.
const ROOT_CLASS =
  'relative overflow-hidden rounded-md border border-neutral-200 bg-white text-sm text-neutral-950 data-[disabled]:opacity-50';
const VIEWPORT_CLASS =
  'max-h-56 overflow-auto p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-950 data-[disabled]:cursor-not-allowed';
const SCROLLBAR_CLASS =
  'absolute flex touch-none select-none bg-neutral-100 p-0.5 transition-colors data-[orientation=vertical]:inset-y-0 data-[orientation=vertical]:right-0 data-[orientation=vertical]:w-2.5 data-[orientation=horizontal]:inset-x-0 data-[orientation=horizontal]:bottom-0 data-[orientation=horizontal]:h-2.5 data-[state=hidden]:opacity-0';
const THUMB_CLASS =
  'absolute left-0 right-0 rounded-full bg-neutral-400 transition-[top,height,width] data-[orientation=vertical]:min-h-8 data-[orientation=horizontal]:min-w-8 data-[state=hidden]:opacity-0';
const CORNER_CLASS =
  'absolute bottom-0 right-0 h-2.5 w-2.5 bg-neutral-100 data-[state=hidden]:hidden';
const TOGGLE_CLASS =
  'inline-flex h-9 w-fit items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 disabled:pointer-events-none disabled:opacity-50';

export interface GalleryScrollAreaDemoState {
  dragging: boolean;
  dragPointerStart: number;
  dragScrollTop: number;
  dragThumbSize: number;
  dragTrackSize: number;
  hasOverflowY: boolean;
  hovering: boolean;
  scrolling: boolean;
  scrollTop: number;
  scrollY: 'end' | 'middle' | 'none' | 'start';
  thumbOffset: number;
  thumbSize: number;
  verticalVisible: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryScrollAreaDemo = component({
  state: () => ({
    dragging: false,
    dragPointerStart: 0,
    dragScrollTop: 0,
    dragThumbSize: 28,
    dragTrackSize: 72,
    hasOverflowY: true,
    hovering: false,
    scrolling: false,
    scrollTop: 0,
    scrollY: 'start' as const,
    thumbOffset: 0,
    thumbSize: 28,
    verticalVisible: true,
  }),
  render: (_queries: Record<string, never>, state: GalleryScrollAreaDemoState) => {
    const rootState = { scrollbars: 'vertical' as const };
    const viewportId = 'gallery-scroll-area-viewport';

    return (
      <section
        {...scrollAreaRootAttributes({ ...rootState, id: 'gallery-scroll-area-root' })}
        class={ROOT_CLASS}
        data-dragging={state.dragging ? '' : null}
        data-gallery-interactive="scroll-area"
        data-has-overflow-y={state.hasOverflowY ? '' : null}
        data-hovering={state.hovering ? '' : null}
        data-scrolling={state.scrolling ? '' : null}
        onPointerEnter={() => {
          state.hovering = true;
        }}
        onPointerLeave={() => {
          state.hovering = false;
          state.dragging = false;
        }}
      >
        <div
          {...scrollAreaViewportAttributes({
            ...rootState,
            id: viewportId,
            label: 'Release notes',
            scrollY: state.scrollY,
          })}
          class={VIEWPORT_CLASS}
          data-has-overflow-y={state.hasOverflowY ? '' : null}
          data-scrolling={state.scrolling ? '' : null}
          data-scroll-y={state.scrollY}
          scrollTop={state.scrollTop}
          style="max-height: 72px; overflow: auto;"
          onScroll={() => {
            const result = _scrollAreaViewportScroll(Object(event), { scrollbars: 'vertical' });
            if (!result) return;

            const geometry = _scrollAreaThumbGeometry(Object(event)['target'], {
              orientation: 'vertical',
              scrollbars: 'vertical',
            });
            state.scrollTop = result.scrollTop;
            state.scrollY = result.scrollY;
            state.thumbOffset = geometry.offsetRatio * 100;
            state.thumbSize = geometry.sizeRatio * 100 < 12 ? 12 : geometry.sizeRatio * 100;
            state.hasOverflowY = result.verticalVisible;
            state.scrolling = true;
            state.verticalVisible = geometry.visible;
          }}
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
            visible: state.verticalVisible && (state.hovering || state.scrolling || state.dragging),
          })}
          class={SCROLLBAR_CLASS}
          data-has-overflow-y={state.hasOverflowY ? '' : null}
          data-hovering={state.hovering ? '' : null}
          data-scrolling={state.scrolling ? '' : null}
          data-state={
            state.verticalVisible && (state.hovering || state.scrolling || state.dragging)
              ? 'visible'
              : 'hidden'
          }
          hidden={!(state.verticalVisible && (state.hovering || state.scrolling || state.dragging))}
          onPointerDown={() => {
            const result = _scrollAreaTrackPointerDown(
              Object(event),
              {
                clientHeight: 72,
                clientWidth: 240,
                scrollHeight: 260,
                scrollLeft: 0,
                scrollTop: state.scrollTop,
                scrollWidth: 240,
              },
              {
                orientation: 'vertical',
                scrollbars: 'vertical',
              },
            );
            if (!result) return;

            const geometry = _scrollAreaThumbGeometry(
              {
                clientHeight: 72,
                clientWidth: 240,
                scrollHeight: 260,
                scrollLeft: 0,
                scrollTop: result.scrollTop,
                scrollWidth: 240,
              },
              {
                orientation: 'vertical',
                scrollbars: 'vertical',
              },
            );
            state.scrollTop = result.scrollTop;
            state.scrollY = result.scrollY;
            state.thumbOffset = geometry.offsetRatio * 100;
            state.thumbSize = geometry.sizeRatio * 100 < 12 ? 12 : geometry.sizeRatio * 100;
            state.hasOverflowY = result.verticalVisible;
            state.scrolling = true;
            state.verticalVisible = geometry.visible;
          }}
        >
          <span
            {...scrollAreaThumbAttributes({
              ...rootState,
              id: 'gallery-scroll-area-thumb',
              orientation: 'vertical',
              scrollPosition: state.scrollY,
              visible:
                state.verticalVisible && (state.hovering || state.scrolling || state.dragging),
            })}
            class={THUMB_CLASS}
            data-dragging={state.dragging ? '' : null}
            data-has-overflow-y={state.hasOverflowY ? '' : null}
            data-hovering={state.hovering ? '' : null}
            data-scrolling={state.scrolling ? '' : null}
            data-scroll-position={state.scrollY}
            data-state={
              state.verticalVisible && (state.hovering || state.scrolling || state.dragging)
                ? 'visible'
                : 'hidden'
            }
            hidden={
              !(state.verticalVisible && (state.hovering || state.scrolling || state.dragging))
            }
            style={{ height: `${state.thumbSize}%`, top: `${state.thumbOffset}%` }}
            onPointerDown={() => {
              const result = _scrollAreaThumbDragStart(
                Object(event),
                {
                  clientHeight: 72,
                  clientWidth: 240,
                  scrollHeight: 260,
                  scrollLeft: 0,
                  scrollTop: state.scrollTop,
                  scrollWidth: 240,
                },
                {
                  orientation: 'vertical',
                  scrollbars: 'vertical',
                },
              );
              if (!result) return;

              state.dragging = true;
              state.dragPointerStart = result.pointerStart;
              state.dragScrollTop = result.scrollStart;
              state.dragThumbSize = result.thumbSize;
              state.dragTrackSize = result.trackSize;
              state.scrolling = true;
            }}
            onPointerMove={() => {
              if (!state.dragging) return;
              const result = _scrollAreaThumbDrag(
                Object(event),
                {
                  clientHeight: 72,
                  clientWidth: 240,
                  scrollHeight: 260,
                  scrollLeft: 0,
                  scrollTop: state.scrollTop,
                  scrollWidth: 240,
                },
                {
                  orientation: 'vertical',
                  pointerStart: state.dragPointerStart,
                  scrollStart: state.dragScrollTop,
                  scrollbars: 'vertical',
                  thumbSize: state.dragThumbSize,
                  trackSize: state.dragTrackSize,
                },
              );
              if (!result) return;

              const geometry = _scrollAreaThumbGeometry(
                {
                  clientHeight: 72,
                  clientWidth: 240,
                  scrollHeight: 260,
                  scrollLeft: 0,
                  scrollTop: result.scrollTop,
                  scrollWidth: 240,
                },
                {
                  orientation: 'vertical',
                  scrollbars: 'vertical',
                },
              );
              state.scrollTop = result.scrollTop;
              state.scrollY = result.scrollY;
              state.thumbOffset = geometry.offsetRatio * 100;
              state.thumbSize = geometry.sizeRatio * 100 < 12 ? 12 : geometry.sizeRatio * 100;
              state.hasOverflowY = result.verticalVisible;
              state.scrolling = true;
              state.verticalVisible = geometry.visible;
            }}
            onPointerUp={() => {
              state.dragging = false;
              state.scrolling = false;
            }}
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
          aria-pressed={state.scrollY === 'end' ? 'true' : 'false'}
          class={TOGGLE_CLASS}
          id="gallery-scroll-area-toggle"
          onClick={() => {
            const nextAtEnd = state.scrollY !== 'end';
            state.scrollTop = nextAtEnd ? 1000000 : 0;
            state.scrollY = nextAtEnd ? 'end' : 'start';
            state.thumbOffset = nextAtEnd ? 100 : 0;
            state.scrolling = true;
          }}
        >
          <span>{state.scrollY === 'end' ? 'Back to top' : 'Jump to end'}</span>
        </button>
        <output data-demo-state="scroll-area-position">{state.scrollY}</output>
      </section>
    );
  },
});
