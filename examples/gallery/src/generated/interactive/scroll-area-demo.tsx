// @kovojs-ir - lowered from examples/gallery/src/interactive/scroll-area-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive, kovoStyleProperty } from '@kovojs/runtime/generated';

export const GalleryScrollAreaDemo$section_data_dragging_derive = derive(['state'], (state: any) =>
  state.dragging ? '' : null,
);
export const GalleryScrollAreaDemo$section_data_has_overflow_y_derive = derive(
  ['state'],
  (state: any) => (state.hasOverflowY ? '' : null),
);
export const GalleryScrollAreaDemo$section_data_hovering_derive = derive(['state'], (state: any) =>
  state.hovering ? '' : null,
);
export const GalleryScrollAreaDemo$section_data_scrolling_derive = derive(['state'], (state: any) =>
  state.scrolling ? '' : null,
);
export const GalleryScrollAreaDemo$div_data_has_overflow_y_derive = derive(
  ['state'],
  (state: any) => (state.hasOverflowY ? '' : null),
);
export const GalleryScrollAreaDemo$div_data_scrolling_derive = derive(['state'], (state: any) =>
  state.scrolling ? '' : null,
);
export const GalleryScrollAreaDemo$div_data_scroll_y_derive = derive(
  ['state'],
  (state: any) => state.scrollY,
);
export const GalleryScrollAreaDemo$div_scrollTop_derive = derive(
  ['state'],
  (state: any) => state.scrollTop,
);
export const GalleryScrollAreaDemo$div_data_has_overflow_y_derive_2 = derive(
  ['state'],
  (state: any) => (state.hasOverflowY ? '' : null),
);
export const GalleryScrollAreaDemo$div_data_hovering_derive = derive(['state'], (state: any) =>
  state.hovering ? '' : null,
);
export const GalleryScrollAreaDemo$div_data_scrolling_derive_2 = derive(['state'], (state: any) =>
  state.scrolling ? '' : null,
);
export const GalleryScrollAreaDemo$div_data_state_derive = derive(['state'], (state: any) =>
  state.verticalVisible && (state.hovering || state.scrolling || state.dragging)
    ? 'visible'
    : 'hidden',
);
export const GalleryScrollAreaDemo$div_hidden_derive = derive(['state'], (state: any) =>
  !(state.verticalVisible && (state.hovering || state.scrolling || state.dragging)) ? '' : null,
);
export const GalleryScrollAreaDemo$span_data_dragging_derive = derive(['state'], (state: any) =>
  state.dragging ? '' : null,
);
export const GalleryScrollAreaDemo$span_data_has_overflow_y_derive = derive(
  ['state'],
  (state: any) => (state.hasOverflowY ? '' : null),
);
export const GalleryScrollAreaDemo$span_data_hovering_derive = derive(['state'], (state: any) =>
  state.hovering ? '' : null,
);
export const GalleryScrollAreaDemo$span_data_scrolling_derive = derive(['state'], (state: any) =>
  state.scrolling ? '' : null,
);
export const GalleryScrollAreaDemo$span_data_scroll_position_derive = derive(
  ['state'],
  (state: any) => state.scrollY,
);
export const GalleryScrollAreaDemo$span_data_state_derive = derive(['state'], (state: any) =>
  state.verticalVisible && (state.hovering || state.scrolling || state.dragging)
    ? 'visible'
    : 'hidden',
);
export const GalleryScrollAreaDemo$span_hidden_derive = derive(['state'], (state: any) =>
  !(state.verticalVisible && (state.hovering || state.scrolling || state.dragging)) ? '' : null,
);
export const GalleryScrollAreaDemo$span_style_derive = derive(['state'], (state: any) =>
  [
    kovoStyleProperty('height', `${state.thumbSize}%`),
    kovoStyleProperty('top', `${state.thumbOffset}%`),
  ]
    .filter(Boolean)
    .join('; '),
);
export const GalleryScrollAreaDemo$button_aria_pressed_derive = derive(['state'], (state: any) =>
  state.scrollY === 'end' ? 'true' : 'false',
);
export const GalleryScrollAreaDemo$span_text_derive = derive(['state'], (state: any) =>
  state.scrollY === 'end' ? 'Back to top' : 'Jump to end',
);

import { component } from '@kovojs/core';
import {
  scrollAreaCornerAttributes,
  scrollAreaRootAttributes,
  scrollAreaScrollbarAttributes,
  scrollAreaThumbAttributes,
  scrollAreaViewportAttributes,
} from '@kovojs/headless-ui/scroll-area';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/scroll-area.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
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
        class={ROOT_CLASS}
        data-gallery-interactive="scroll-area"
        on:pointerenter="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$section_pointerenter"
        on:pointerleave="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$section_pointerleave"
        {...scrollAreaRootAttributes({ ...rootState, id: 'gallery-scroll-area-root' })}
        data-dragging={state.dragging ? '' : null}
        data-bind:data-dragging="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$section_data_dragging_derive"
        data-has-overflow-y={state.hasOverflowY ? '' : null}
        data-bind:data-has-overflow-y="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$section_data_has_overflow_y_derive"
        data-hovering={state.hovering ? '' : null}
        data-bind:data-hovering="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$section_data_hovering_derive"
        data-scrolling={state.scrolling ? '' : null}
        data-bind:data-scrolling="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$section_data_scrolling_derive"
        kovo-c="gallery-scroll-area-demo"
        kovo-state='{"dragging":false,"dragPointerStart":0,"dragScrollTop":0,"dragThumbSize":28,"dragTrackSize":72,"hasOverflowY":true,"hovering":false,"scrolling":false,"scrollTop":0,"scrollY":"start","thumbOffset":0,"thumbSize":28,"verticalVisible":true}'
      >
        <div
          class={VIEWPORT_CLASS}
          style="max-height: 72px; overflow: auto;"
          on:scroll="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$div_scroll"
          {...scrollAreaViewportAttributes({
            ...rootState,
            id: viewportId,
            label: 'Release notes',
            scrollY: state.scrollY,
          })}
          data-has-overflow-y={state.hasOverflowY ? '' : null}
          data-bind:data-has-overflow-y="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$div_data_has_overflow_y_derive"
          data-scrolling={state.scrolling ? '' : null}
          data-bind:data-scrolling="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$div_data_scrolling_derive"
          data-scroll-y={state.scrollY}
          data-bind:data-scroll-y="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$div_data_scroll_y_derive"
          scrollTop={state.scrollTop}
          data-bind:scrollTop="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$div_scrollTop_derive"
        >
          <div style="min-height: 260px;">
            <p>Framework primitives keep native scrolling in charge.</p>
            <p>Scrollbars expose stable data attributes for styled wrappers.</p>
            <p>Browser coverage checks focusability, labels, and live scroll position.</p>
            <p>Generated handlers can coordinate visible state without authoring lowered IR.</p>
          </div>
        </div>
        <div
          class={SCROLLBAR_CLASS}
          on:pointerdown="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$div_pointerdown"
          {...scrollAreaScrollbarAttributes({
            ...rootState,
            id: 'gallery-scroll-area-scrollbar',
            orientation: 'vertical',
            visible: state.verticalVisible && (state.hovering || state.scrolling || state.dragging),
          })}
          data-has-overflow-y={state.hasOverflowY ? '' : null}
          data-bind:data-has-overflow-y="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$div_data_has_overflow_y_derive_2"
          data-hovering={state.hovering ? '' : null}
          data-bind:data-hovering="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$div_data_hovering_derive"
          data-scrolling={state.scrolling ? '' : null}
          data-bind:data-scrolling="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$div_data_scrolling_derive_2"
          data-state={
            state.verticalVisible && (state.hovering || state.scrolling || state.dragging)
              ? 'visible'
              : 'hidden'
          }
          data-bind:data-state="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$div_data_state_derive"
          hidden={!(state.verticalVisible && (state.hovering || state.scrolling || state.dragging))}
          data-bind:hidden="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$div_hidden_derive"
        >
          <span
            class={THUMB_CLASS}
            on:pointerdown="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$span_pointerdown"
            on:pointermove="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$span_pointermove"
            on:pointerup="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$span_pointerup"
            {...scrollAreaThumbAttributes({
              ...rootState,
              id: 'gallery-scroll-area-thumb',
              orientation: 'vertical',
              scrollPosition: state.scrollY,
              visible:
                state.verticalVisible && (state.hovering || state.scrolling || state.dragging),
            })}
            data-dragging={state.dragging ? '' : null}
            data-bind:data-dragging="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$span_data_dragging_derive"
            data-has-overflow-y={state.hasOverflowY ? '' : null}
            data-bind:data-has-overflow-y="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$span_data_has_overflow_y_derive"
            data-hovering={state.hovering ? '' : null}
            data-bind:data-hovering="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$span_data_hovering_derive"
            data-scrolling={state.scrolling ? '' : null}
            data-bind:data-scrolling="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$span_data_scrolling_derive"
            data-scroll-position={state.scrollY}
            data-bind:data-scroll-position="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$span_data_scroll_position_derive"
            data-state={
              state.verticalVisible && (state.hovering || state.scrolling || state.dragging)
                ? 'visible'
                : 'hidden'
            }
            data-bind:data-state="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$span_data_state_derive"
            hidden={
              !(state.verticalVisible && (state.hovering || state.scrolling || state.dragging))
            }
            data-bind:hidden="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$span_hidden_derive"
            style={{ height: `${state.thumbSize}%`, top: `${state.thumbOffset}%` }}
            data-bind:style="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$span_style_derive"
          />
        </div>
        <div
          class={CORNER_CLASS}
          {...scrollAreaCornerAttributes({
            ...rootState,
            id: 'gallery-scroll-area-corner',
            visible: false,
          })}
        />
        <button
          aria-controls={viewportId}
          class={TOGGLE_CLASS}
          id="gallery-scroll-area-toggle"
          on:click="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$button_click"
          aria-pressed={state.scrollY === 'end' ? 'true' : 'false'}
          data-bind:aria-pressed="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$button_aria_pressed_derive"
        >
          <span data-bind="/c/__v/76c86589/examples/gallery/src/generated/interactive/scroll-area-demo.client.js#GalleryScrollAreaDemo$span_text_derive">
            {state.scrollY === 'end' ? 'Back to top' : 'Jump to end'}
          </span>
        </button>
        <output data-demo-state="scroll-area-position" data-bind="state.scrollY">
          {state.scrollY}
        </output>
      </section>
    );
  },
});
GalleryScrollAreaDemo.name = 'generated/interactive/scroll-area-demo/gallery-scroll-area-demo';
