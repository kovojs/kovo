// @kovojs-ir - lowered from examples/gallery/src/interactive/scroll-area-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive, kovoStyleProperty } from '@kovojs/runtime/generated';

export const GalleryScrollAreaDemo$ScrollArea_data_dragging_derive = derive(
  ['state'],
  (state: any) => (state.dragging ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollArea_data_has_overflow_y_derive = derive(
  ['state'],
  (state: any) => (state.hasOverflowY ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollArea_data_hovering_derive = derive(
  ['state'],
  (state: any) => (state.hovering ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollArea_data_scrolling_derive = derive(
  ['state'],
  (state: any) => (state.scrolling ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaViewport_data_has_overflow_y_derive = derive(
  ['state'],
  (state: any) => (state.hasOverflowY ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaViewport_data_scrolling_derive = derive(
  ['state'],
  (state: any) => (state.scrolling ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaViewport_data_scroll_y_derive = derive(
  ['state'],
  (state: any) => state.scrollY,
);
export const GalleryScrollAreaDemo$ScrollAreaViewport_scrollTop_derive = derive(
  ['state'],
  (state: any) => state.scrollTop,
);
export const GalleryScrollAreaDemo$ScrollAreaViewport_scrollY_derive = derive(
  ['state'],
  (state: any) => state.scrollY,
);
export const GalleryScrollAreaDemo$ScrollAreaScrollbar_data_has_overflow_y_derive = derive(
  ['state'],
  (state: any) => (state.hasOverflowY ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaScrollbar_data_hovering_derive = derive(
  ['state'],
  (state: any) => (state.hovering ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaScrollbar_data_scrolling_derive = derive(
  ['state'],
  (state: any) => (state.scrolling ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaScrollbar_data_state_derive = derive(
  ['state'],
  (state: any) =>
    state.verticalVisible && (state.hovering || state.scrolling || state.dragging)
      ? 'visible'
      : 'hidden',
);
export const GalleryScrollAreaDemo$ScrollAreaScrollbar_hidden_derive = derive(
  ['state'],
  (state: any) =>
    !(state.verticalVisible && (state.hovering || state.scrolling || state.dragging)) ? '' : null,
);
export const GalleryScrollAreaDemo$ScrollAreaScrollbar_visible_derive = derive(
  ['state'],
  (state: any) => state.verticalVisible && (state.hovering || state.scrolling || state.dragging),
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_data_dragging_derive = derive(
  ['state'],
  (state: any) => (state.dragging ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_data_has_overflow_y_derive = derive(
  ['state'],
  (state: any) => (state.hasOverflowY ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_data_hovering_derive = derive(
  ['state'],
  (state: any) => (state.hovering ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_data_scrolling_derive = derive(
  ['state'],
  (state: any) => (state.scrolling ? '' : null),
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_data_scroll_position_derive = derive(
  ['state'],
  (state: any) => state.scrollY,
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_data_state_derive = derive(
  ['state'],
  (state: any) =>
    state.verticalVisible && (state.hovering || state.scrolling || state.dragging)
      ? 'visible'
      : 'hidden',
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_hidden_derive = derive(['state'], (state: any) =>
  !(state.verticalVisible && (state.hovering || state.scrolling || state.dragging)) ? '' : null,
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_style_derive = derive(['state'], (state: any) =>
  [
    kovoStyleProperty('height', `${state.thumbSize}%`),
    kovoStyleProperty('top', `${state.thumbOffset}%`),
  ]
    .filter(Boolean)
    .join('; '),
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_scrollPosition_derive = derive(
  ['state'],
  (state: any) => state.scrollY,
);
export const GalleryScrollAreaDemo$ScrollAreaThumb_visible_derive = derive(
  ['state'],
  (state: any) => state.verticalVisible && (state.hovering || state.scrolling || state.dragging),
);
export const GalleryScrollAreaDemo$button_aria_pressed_derive = derive(['state'], (state: any) =>
  state.scrollY === 'end' ? 'true' : 'false',
);
export const GalleryScrollAreaDemo$span_text_derive = derive(['state'], (state: any) =>
  state.scrollY === 'end' ? 'Back to top' : 'Jump to end',
);

import { component } from '@kovojs/core';
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
        data-gallery-interactive="scroll-area"
        id="gallery-scroll-area-root"
        on:pointerenter="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollArea_pointerenter"
        on:pointerleave="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollArea_pointerleave"
        {...rootState}
        data-dragging={state.dragging ? '' : null}
        data-bind:data-dragging="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollArea_data_dragging_derive"
        data-has-overflow-y={state.hasOverflowY ? '' : null}
        data-bind:data-has-overflow-y="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollArea_data_has_overflow_y_derive"
        data-hovering={state.hovering ? '' : null}
        data-bind:data-hovering="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollArea_data_hovering_derive"
        data-scrolling={state.scrolling ? '' : null}
        data-bind:data-scrolling="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollArea_data_scrolling_derive"
        kovo-state='{"dragging":false,"dragPointerStart":0,"dragScrollTop":0,"dragThumbSize":28,"dragTrackSize":72,"hasOverflowY":true,"hovering":false,"scrolling":false,"scrollTop":0,"scrollY":"start","thumbOffset":0,"thumbSize":28,"verticalVisible":true}'
      >
        <ScrollAreaViewport
          id={viewportId}
          label="Release notes"
          style="max-height: 72px; overflow: auto;"
          on:scroll="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaViewport_scroll"
          {...rootState}
          data-has-overflow-y={state.hasOverflowY ? '' : null}
          data-bind:data-has-overflow-y="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaViewport_data_has_overflow_y_derive"
          data-scrolling={state.scrolling ? '' : null}
          data-bind:data-scrolling="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaViewport_data_scrolling_derive"
          data-scroll-y={state.scrollY}
          data-bind:data-scroll-y="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaViewport_data_scroll_y_derive"
          scrollTop={state.scrollTop}
          data-bind:scrollTop="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaViewport_scrollTop_derive"
          scrollY={state.scrollY}
          data-bind:scrollY="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaViewport_scrollY_derive"
        >
          <div style="min-height: 260px;">
            <p>Framework primitives keep native scrolling in charge.</p>
            <p>Scrollbars expose stable data attributes for styled wrappers.</p>
            <p>Browser coverage checks focusability, labels, and live scroll position.</p>
            <p>Generated handlers can coordinate visible state without authoring lowered IR.</p>
          </div>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar
          id="gallery-scroll-area-scrollbar"
          on:pointerdown="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaScrollbar_pointerdown"
          orientation="vertical"
          {...rootState}
          data-has-overflow-y={state.hasOverflowY ? '' : null}
          data-bind:data-has-overflow-y="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaScrollbar_data_has_overflow_y_derive"
          data-hovering={state.hovering ? '' : null}
          data-bind:data-hovering="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaScrollbar_data_hovering_derive"
          data-scrolling={state.scrolling ? '' : null}
          data-bind:data-scrolling="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaScrollbar_data_scrolling_derive"
          data-state={
            state.verticalVisible && (state.hovering || state.scrolling || state.dragging)
              ? 'visible'
              : 'hidden'
          }
          data-bind:data-state="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaScrollbar_data_state_derive"
          hidden={!(state.verticalVisible && (state.hovering || state.scrolling || state.dragging))}
          data-bind:hidden="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaScrollbar_hidden_derive"
          visible={state.verticalVisible && (state.hovering || state.scrolling || state.dragging)}
          data-bind:visible="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaScrollbar_visible_derive"
        >
          <ScrollAreaThumb
            id="gallery-scroll-area-thumb"
            on:pointerdown="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaThumb_pointerdown"
            on:pointermove="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaThumb_pointermove"
            on:pointerup="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaThumb_pointerup"
            orientation="vertical"
            {...rootState}
            data-dragging={state.dragging ? '' : null}
            data-bind:data-dragging="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaThumb_data_dragging_derive"
            data-has-overflow-y={state.hasOverflowY ? '' : null}
            data-bind:data-has-overflow-y="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaThumb_data_has_overflow_y_derive"
            data-hovering={state.hovering ? '' : null}
            data-bind:data-hovering="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaThumb_data_hovering_derive"
            data-scrolling={state.scrolling ? '' : null}
            data-bind:data-scrolling="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaThumb_data_scrolling_derive"
            data-scroll-position={state.scrollY}
            data-bind:data-scroll-position="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaThumb_data_scroll_position_derive"
            data-state={
              state.verticalVisible && (state.hovering || state.scrolling || state.dragging)
                ? 'visible'
                : 'hidden'
            }
            data-bind:data-state="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaThumb_data_state_derive"
            hidden={
              !(state.verticalVisible && (state.hovering || state.scrolling || state.dragging))
            }
            data-bind:hidden="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaThumb_hidden_derive"
            style={{ height: `${state.thumbSize}%`, top: `${state.thumbOffset}%` }}
            data-bind:style="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaThumb_style_derive"
            scrollPosition={state.scrollY}
            data-bind:scrollPosition="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaThumb_scrollPosition_derive"
            visible={state.verticalVisible && (state.hovering || state.scrolling || state.dragging)}
            data-bind:visible="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$ScrollAreaThumb_visible_derive"
          />
        </ScrollAreaScrollbar>
        <ScrollAreaCorner id="gallery-scroll-area-corner" visible={false} {...rootState} />
        <button
          aria-controls={viewportId}
          class={TOGGLE_CLASS}
          id="gallery-scroll-area-toggle"
          on:click="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$button_click"
          aria-pressed={state.scrollY === 'end' ? 'true' : 'false'}
          data-bind:aria-pressed="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$button_aria_pressed_derive"
        >
          <span data-bind="/c/__v/a83fe440/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$span_text_derive">
            {state.scrollY === 'end' ? 'Back to top' : 'Jump to end'}
          </span>
        </button>
        <output data-demo-state="scroll-area-position" data-bind="state.scrollY">
          {state.scrollY}
        </output>
      </ScrollArea>
    );
  },
});
GalleryScrollAreaDemo.name = 'generated/interactive/scroll-area-demo/gallery-scroll-area-demo';
