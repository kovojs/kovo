/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  scrollAreaThumbDrag as _scrollAreaThumbDrag,
  scrollAreaThumbDragStart as _scrollAreaThumbDragStart,
  scrollAreaThumbGeometry as _scrollAreaThumbGeometry,
  scrollAreaTrackPointerDown as _scrollAreaTrackPointerDown,
  scrollAreaViewportScroll as _scrollAreaViewportScroll,
} from '@kovojs/headless-ui/scroll-area';
import {
  ScrollArea,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@kovojs/ui/scroll-area';

// The viewport keeps its inline max-height/overflow style so the demo stays short
// enough to scroll; that inline style wins over the @kovojs/ui max-h-56 utility.
// The jump-to-end control keeps local demo button classes because it is not part
// of the scroll-area component surface.
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
      <ScrollArea
        {...rootState}
        data-dragging={state.dragging ? '' : null}
        data-gallery-interactive="scroll-area"
        data-has-overflow-y={state.hasOverflowY ? '' : null}
        data-hovering={state.hovering ? '' : null}
        data-scrolling={state.scrolling ? '' : null}
        id="gallery-scroll-area-root"
        onPointerEnter={() => {
          state.hovering = true;
        }}
        onPointerLeave={() => {
          state.hovering = false;
          state.dragging = false;
        }}
      >
        <ScrollAreaViewport
          {...rootState}
          data-has-overflow-y={state.hasOverflowY ? '' : null}
          data-scrolling={state.scrolling ? '' : null}
          data-scroll-y={state.scrollY}
          id={viewportId}
          label="Release notes"
          scrollTop={state.scrollTop}
          scrollY={state.scrollY}
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
        </ScrollAreaViewport>
        <ScrollAreaScrollbar
          {...rootState}
          data-has-overflow-y={state.hasOverflowY ? '' : null}
          data-hovering={state.hovering ? '' : null}
          data-scrolling={state.scrolling ? '' : null}
          data-state={
            state.verticalVisible && (state.hovering || state.scrolling || state.dragging)
              ? 'visible'
              : 'hidden'
          }
          hidden={!(state.verticalVisible && (state.hovering || state.scrolling || state.dragging))}
          id="gallery-scroll-area-scrollbar"
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
          orientation="vertical"
          visible={state.verticalVisible && (state.hovering || state.scrolling || state.dragging)}
        >
          <ScrollAreaThumb
            {...rootState}
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
            id="gallery-scroll-area-thumb"
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
            orientation="vertical"
            scrollPosition={state.scrollY}
            visible={state.verticalVisible && (state.hovering || state.scrolling || state.dragging)}
          />
        </ScrollAreaScrollbar>
        <ScrollAreaCorner {...rootState} id="gallery-scroll-area-corner" visible={false} />
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
      </ScrollArea>
    );
  },
});
