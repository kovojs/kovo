import {
  dataDisabled,
  dataOrientation,
  dataState,
  mergeDataAttributes,
  type PrimitiveDataAttributes,
  type TextDirection,
} from '../lib/index.js';

/**
 * Public type used by the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaOrientation } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaOrientation = {} as ScrollAreaOrientation;
 * ```
 */
export type ScrollAreaOrientation = 'horizontal' | 'vertical';

/**
 * Public type used by the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaScrollPosition } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaScrollPosition = {} as ScrollAreaScrollPosition;
 * ```
 */
export type ScrollAreaScrollPosition = 'end' | 'middle' | 'none' | 'start';

/**
 * Public type used by the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaScrollbars } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaScrollbars = {} as ScrollAreaScrollbars;
 * ```
 */
export type ScrollAreaScrollbars = 'both' | 'horizontal' | 'none' | 'vertical';

/**
 * State snapshot consumed by the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaVisibilityState } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaVisibilityState = {} as ScrollAreaVisibilityState;
 * ```
 */
export type ScrollAreaVisibilityState = 'hidden' | 'visible';

/**
 * State snapshot consumed by the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaState } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaState = {} as ScrollAreaState;
 * ```
 */
export interface ScrollAreaState {
  disabled?: boolean;
  dir?: TextDirection;
  hasOverflowX?: boolean;
  hasOverflowY?: boolean;
  hovering?: boolean;
  scrolling?: boolean;
  scrollbars?: ScrollAreaScrollbars;
}

/**
 * Options accepted by the Scroll Area primitive scroll area root attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaRootAttributeOptions } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaRootAttributeOptions = {} as ScrollAreaRootAttributeOptions;
 * ```
 */
export interface ScrollAreaRootAttributeOptions extends ScrollAreaState {
  id?: string;
}

/**
 * Options accepted by the Scroll Area primitive scroll area viewport attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaViewportAttributeOptions } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaViewportAttributeOptions = {} as ScrollAreaViewportAttributeOptions;
 * ```
 */
export interface ScrollAreaViewportAttributeOptions extends ScrollAreaState {
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
  scrollX?: ScrollAreaScrollPosition;
  scrollY?: ScrollAreaScrollPosition;
}

/**
 * Options accepted by the Scroll Area primitive scroll area scrollbar attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaScrollbarAttributeOptions } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaScrollbarAttributeOptions = {} as ScrollAreaScrollbarAttributeOptions;
 * ```
 */
export interface ScrollAreaScrollbarAttributeOptions extends ScrollAreaState {
  forceMount?: boolean;
  id?: string;
  orientation?: ScrollAreaOrientation;
  scrollPosition?: ScrollAreaScrollPosition;
  visible?: boolean;
}

/**
 * Options accepted by the Scroll Area primitive scroll area thumb attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaThumbAttributeOptions } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaThumbAttributeOptions = {} as ScrollAreaThumbAttributeOptions;
 * ```
 */
export interface ScrollAreaThumbAttributeOptions extends ScrollAreaScrollbarAttributeOptions {}

/**
 * Options accepted by the Scroll Area primitive scroll area corner attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaCornerAttributeOptions } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaCornerAttributeOptions = {} as ScrollAreaCornerAttributeOptions;
 * ```
 */
export interface ScrollAreaCornerAttributeOptions extends ScrollAreaState {
  forceMount?: boolean;
  id?: string;
  visible?: boolean;
}

/**
 * Serializable attribute record returned by Scroll Area primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaPrimitiveAttributes } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaPrimitiveAttributes = {} as ScrollAreaPrimitiveAttributes;
 * ```
 */
export type ScrollAreaPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

/**
 * Public interface used by the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaViewportTarget } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaViewportTarget = {} as ScrollAreaViewportTarget;
 * ```
 */
export interface ScrollAreaViewportTarget {
  readonly clientHeight: number;
  readonly clientWidth: number;
  readonly scrollHeight: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly scrollWidth: number;
}

/**
 * Public interface used by the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaPointerTarget } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaPointerTarget = {} as ScrollAreaPointerTarget;
 * ```
 */
export interface ScrollAreaPointerTarget {
  readonly clientHeight?: number;
  readonly clientWidth?: number;
  readonly parentElement?: ScrollAreaPointerTarget | null;
  readonly getBoundingClientRect?: () => {
    readonly height: number;
    readonly left: number;
    readonly top: number;
    readonly width: number;
  };
}

/**
 * Options accepted by the Scroll Area primitive scroll area thumb geometry.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaThumbGeometryOptions } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaThumbGeometryOptions = {} as ScrollAreaThumbGeometryOptions;
 * ```
 */
export interface ScrollAreaThumbGeometryOptions extends ScrollAreaState {
  orientation?: ScrollAreaOrientation;
}

/**
 * State snapshot consumed by the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaViewportComputedState } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaViewportComputedState = {} as ScrollAreaViewportComputedState;
 * ```
 */
export interface ScrollAreaViewportComputedState {
  readonly cornerVisible: boolean;
  readonly horizontalVisible: boolean;
  readonly maxScrollLeft: number;
  readonly maxScrollTop: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly scrollX: ScrollAreaScrollPosition;
  readonly scrollXRatio: number;
  readonly scrollY: ScrollAreaScrollPosition;
  readonly scrollYRatio: number;
  readonly verticalVisible: boolean;
}

/**
 * Result returned by the Scroll Area primitive scroll area viewport scroll.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaViewportScrollResult } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaViewportScrollResult = {} as ScrollAreaViewportScrollResult;
 * ```
 */
export type ScrollAreaViewportScrollResult = ScrollAreaViewportComputedState;

/**
 * Public interface used by the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaThumbGeometry } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaThumbGeometry = {} as ScrollAreaThumbGeometry;
 * ```
 */
export interface ScrollAreaThumbGeometry {
  readonly offsetRatio: number;
  readonly scrollPosition: ScrollAreaScrollPosition;
  readonly sizeRatio: number;
  readonly visible: boolean;
}

/**
 * Public interface used by the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaThumbDragStart } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaThumbDragStart = {} as ScrollAreaThumbDragStart;
 * ```
 */
export interface ScrollAreaThumbDragStart {
  readonly pointerStart: number;
  readonly scrollStart: number;
  readonly thumbSize: number;
  readonly trackSize: number;
}

/**
 * Options accepted by the Scroll Area primitive scroll area thumb drag.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaThumbDragOptions } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaThumbDragOptions = {} as ScrollAreaThumbDragOptions;
 * ```
 */
export interface ScrollAreaThumbDragOptions extends ScrollAreaState {
  orientation?: ScrollAreaOrientation;
  pointerStart: number;
  scrollStart: number;
  thumbSize: number;
  trackSize: number;
}

/**
 * Event shape consumed by the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaViewportScrollEvent } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaViewportScrollEvent = {} as ScrollAreaViewportScrollEvent;
 * ```
 */
export type ScrollAreaViewportScrollEvent = Event & {
  readonly currentTarget: ScrollAreaViewportTarget | null;
  readonly target?: Partial<ScrollAreaViewportTarget> | null;
};

/**
 * Event shape consumed by the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaPointerEvent } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaPointerEvent = {} as ScrollAreaPointerEvent;
 * ```
 */
export type ScrollAreaPointerEvent = Event & {
  readonly clientX?: number;
  readonly clientY?: number;
  readonly currentTarget?: ScrollAreaPointerTarget | null;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly target?: ScrollAreaPointerTarget | null;
};

/**
 * Builds the scroll area root attributes record for the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { scrollAreaRootAttributes } from '@kovojs/headless-ui/scroll-area';
 *
 * const input = {} as Parameters<typeof scrollAreaRootAttributes>[0];
 * const result = scrollAreaRootAttributes(input);
 * ```
 */
export function scrollAreaRootAttributes(
  options: ScrollAreaRootAttributeOptions = {},
): ScrollAreaPrimitiveAttributes {
  return Object.freeze({
    ...scrollAreaDataAttributes(options),
    ...(options.dir === undefined ? {} : { dir: options.dir }),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Builds the scroll area viewport attributes record for the Scroll Area primitive.
 *
 * Emits `aria-describedby`, `aria-disabled`, `aria-label`, `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { scrollAreaViewportAttributes } from '@kovojs/headless-ui/scroll-area';
 *
 * const input = {} as Parameters<typeof scrollAreaViewportAttributes>[0];
 * const result = scrollAreaViewportAttributes(input);
 * ```
 */
export function scrollAreaViewportAttributes(
  options: ScrollAreaViewportAttributeOptions = {},
): ScrollAreaPrimitiveAttributes {
  return Object.freeze({
    ...scrollAreaDataAttributes(options),
    ...scrollAreaViewportScrollDataAttributes(options),
    tabIndex: options.disabled === true ? -1 : 0,
    ...(options.descriptionId === undefined ? {} : { 'aria-describedby': options.descriptionId }),
    ...(options.disabled === true ? { 'aria-disabled': 'true' } : {}),
    ...(options.label === undefined && options.labelledBy === undefined ? {} : { role: 'region' }),
    ...(options.label === undefined ? {} : { 'aria-label': options.label }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Builds the scroll area scrollbar attributes record for the Scroll Area primitive.
 *
 * Emits `aria-hidden`, `hidden`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { scrollAreaScrollbarAttributes } from '@kovojs/headless-ui/scroll-area';
 *
 * const input = {} as Parameters<typeof scrollAreaScrollbarAttributes>[0];
 * const result = scrollAreaScrollbarAttributes(input);
 * ```
 */
export function scrollAreaScrollbarAttributes(
  options: ScrollAreaScrollbarAttributeOptions = {},
): ScrollAreaPrimitiveAttributes {
  const orientation = scrollAreaOrientation(options.orientation);
  const state = scrollAreaScrollbarState(options);

  return Object.freeze({
    ...scrollAreaPartDataAttributes({ ...options, orientation, state }),
    'aria-hidden': 'true',
    ...(state === 'hidden' && options.forceMount !== true ? { hidden: true } : {}),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Builds the scroll area thumb attributes record for the Scroll Area primitive.
 *
 * Emits `aria-hidden`, `hidden`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { scrollAreaThumbAttributes } from '@kovojs/headless-ui/scroll-area';
 *
 * const input = {} as Parameters<typeof scrollAreaThumbAttributes>[0];
 * const result = scrollAreaThumbAttributes(input);
 * ```
 */
export function scrollAreaThumbAttributes(
  options: ScrollAreaThumbAttributeOptions = {},
): ScrollAreaPrimitiveAttributes {
  const orientation = scrollAreaOrientation(options.orientation);
  const state = scrollAreaScrollbarState(options);

  return Object.freeze({
    ...scrollAreaPartDataAttributes({ ...options, orientation, state }),
    'aria-hidden': 'true',
    ...(state === 'hidden' && options.forceMount !== true ? { hidden: true } : {}),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Builds the scroll area corner attributes record for the Scroll Area primitive.
 *
 * Emits `aria-hidden`, `hidden`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { scrollAreaCornerAttributes } from '@kovojs/headless-ui/scroll-area';
 *
 * const input = {} as Parameters<typeof scrollAreaCornerAttributes>[0];
 * const result = scrollAreaCornerAttributes(input);
 * ```
 */
export function scrollAreaCornerAttributes(
  options: ScrollAreaCornerAttributeOptions = {},
): ScrollAreaPrimitiveAttributes {
  const state = scrollAreaCornerState(options);

  return Object.freeze({
    ...mergeDataAttributes(scrollAreaDataAttributes(options), dataState(state)),
    'aria-hidden': 'true',
    ...(state === 'hidden' && options.forceMount !== true ? { hidden: true } : {}),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Computes scroll area scrollbar state for the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { scrollAreaScrollbarState } from '@kovojs/headless-ui/scroll-area';
 *
 * const input = {} as Parameters<typeof scrollAreaScrollbarState>[0];
 * const result = scrollAreaScrollbarState(input);
 * ```
 */
export function scrollAreaScrollbarState(
  options: ScrollAreaScrollbarAttributeOptions = {},
): ScrollAreaVisibilityState {
  if (options.disabled === true) return 'hidden';
  if (!scrollAreaScrollbarEnabled(options, scrollAreaOrientation(options.orientation))) {
    return 'hidden';
  }

  return options.visible === false ? 'hidden' : 'visible';
}

/**
 * Computes scroll area corner state for the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { scrollAreaCornerState } from '@kovojs/headless-ui/scroll-area';
 *
 * const input = {} as Parameters<typeof scrollAreaCornerState>[0];
 * const result = scrollAreaCornerState(input);
 * ```
 */
export function scrollAreaCornerState(
  options: ScrollAreaCornerAttributeOptions = {},
): ScrollAreaVisibilityState {
  if (options.disabled === true) return 'hidden';
  if (scrollAreaScrollbars(options.scrollbars) !== 'both') return 'hidden';

  return options.visible === false ? 'hidden' : 'visible';
}

/**
 * Computes scroll area viewport state for the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { scrollAreaViewportState } from '@kovojs/headless-ui/scroll-area';
 *
 * const input = {} as Parameters<typeof scrollAreaViewportState>[0];
 * const state = {} as Parameters<typeof scrollAreaViewportState>[1];
 * const result = scrollAreaViewportState(input, state);
 * ```
 */
export function scrollAreaViewportState(
  target: ScrollAreaViewportTarget,
  state: ScrollAreaState = {},
): ScrollAreaViewportComputedState {
  const scrollX = scrollAreaAxisState(
    target.scrollWidth,
    target.clientWidth,
    target.scrollLeft,
    state,
    'horizontal',
  );
  const scrollY = scrollAreaAxisState(
    target.scrollHeight,
    target.clientHeight,
    target.scrollTop,
    state,
    'vertical',
  );
  const horizontalVisible = scrollX.position !== 'none';
  const verticalVisible = scrollY.position !== 'none';

  // SPEC.md §4.6: scroll-area keeps scrolling native; these facts only make
  // the native viewport state legible for decorative parts and authored state.
  return Object.freeze({
    cornerVisible:
      state.disabled !== true &&
      scrollAreaScrollbars(state.scrollbars) === 'both' &&
      horizontalVisible &&
      verticalVisible,
    horizontalVisible,
    maxScrollLeft: scrollX.max,
    maxScrollTop: scrollY.max,
    scrollLeft: scrollX.offset,
    scrollTop: scrollY.offset,
    scrollX: scrollX.position,
    scrollXRatio: scrollX.ratio,
    scrollY: scrollY.position,
    scrollYRatio: scrollY.ratio,
    verticalVisible,
  });
}

/**
 * Computes scroll area thumb geometry for the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { scrollAreaThumbGeometry } from '@kovojs/headless-ui/scroll-area';
 *
 * const input = {} as Parameters<typeof scrollAreaThumbGeometry>[0];
 * const state = {} as Parameters<typeof scrollAreaThumbGeometry>[1];
 * const result = scrollAreaThumbGeometry(input, state);
 * ```
 */
export function scrollAreaThumbGeometry(
  target: ScrollAreaViewportTarget,
  options: ScrollAreaThumbGeometryOptions = {},
): ScrollAreaThumbGeometry {
  const orientation = scrollAreaOrientation(options.orientation);
  const viewport = scrollAreaViewportState(target, options);
  const clientSize =
    orientation === 'vertical'
      ? finiteScrollNumber(target.clientHeight)
      : finiteScrollNumber(target.clientWidth);
  const scrollSize =
    orientation === 'vertical'
      ? finiteScrollNumber(target.scrollHeight)
      : finiteScrollNumber(target.scrollWidth);
  const visible =
    orientation === 'vertical' ? viewport.verticalVisible : viewport.horizontalVisible;

  return Object.freeze({
    offsetRatio: orientation === 'vertical' ? viewport.scrollYRatio : viewport.scrollXRatio,
    scrollPosition: orientation === 'vertical' ? viewport.scrollY : viewport.scrollX,
    sizeRatio: visible && scrollSize > 0 ? Math.min(1, Math.max(0, clientSize / scrollSize)) : 0,
    visible,
  });
}

/**
 * Computes scroll area viewport scroll for the Scroll Area primitive.
 *
 * @example
 * ```ts
 * import { scrollAreaViewportScroll } from '@kovojs/headless-ui/scroll-area';
 *
 * const input = {} as Parameters<typeof scrollAreaViewportScroll>[0];
 * const state = {} as Parameters<typeof scrollAreaViewportScroll>[1];
 * const result = scrollAreaViewportScroll(input, state);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function scrollAreaViewportScroll(
  event: ScrollAreaViewportScrollEvent,
  state: ScrollAreaState = {},
): ScrollAreaViewportScrollResult | undefined {
  if (event.defaultPrevented) return;

  const target = scrollAreaViewportEventTarget(event);
  if (target === undefined) return;

  return scrollAreaViewportState(target, state);
}

/**
 * Public interface used by the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaScrollToTrigger } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaScrollToTrigger = {} as ScrollAreaScrollToTrigger;
 * ```
 */
export interface ScrollAreaScrollToTrigger {
  getAttribute(name: string): string | null;
  readonly ownerDocument?: {
    getElementById(id: string): ScrollAreaScrollToViewport | null;
  } | null;
}

/**
 * Public interface used by the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaScrollToViewport } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaScrollToViewport = {} as ScrollAreaScrollToViewport;
 * ```
 */
export interface ScrollAreaScrollToViewport {
  scrollTop: number;
  readonly scrollHeight: number;
}

/**
 * Event shape consumed by the Scroll Area primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaScrollToEvent } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaScrollToEvent = {} as ScrollAreaScrollToEvent;
 * ```
 */
export type ScrollAreaScrollToEvent = Event & {
  readonly currentTarget?: ScrollAreaScrollToTrigger | null;
  readonly target?: ScrollAreaScrollToTrigger | null;
};

/**
 * Result returned by the Scroll Area primitive scroll area scroll to.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ScrollAreaScrollToResult } from '@kovojs/headless-ui/scroll-area';
 *
 * const value: ScrollAreaScrollToResult = {} as ScrollAreaScrollToResult;
 * ```
 */
export interface ScrollAreaScrollToResult {
  scrollTop: number;
  scrollY: 'end' | 'start';
}

/**
 * Computes scroll area scroll to for the Scroll Area primitive.
 *
 * @example
 * ```ts
 * import { scrollAreaScrollTo } from '@kovojs/headless-ui/scroll-area';
 *
 * const input = {} as Parameters<typeof scrollAreaScrollTo>[0];
 * const state = {} as Parameters<typeof scrollAreaScrollTo>[1];
 * const result = scrollAreaScrollTo(input, state);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * Imperatively scrolls the viewport to the top/bottom in response to a control
 * (e.g. a "Jump to end" button). A `data-bind:*` stamp only writes an attribute,
 * never the live `.scrollTop` property, so a property-backed scroll needs an
 * imperative action. The viewport is reached through the event — the trigger's
 * `aria-controls` id resolved via `ownerDocument.getElementById` — so the handler
 * captures no unserializable closure value (KV201-safe; the prior inline attempt
 * captured a render-scope id). Setting `.scrollTop` fires the native `scroll`
 * event, so the viewport's own scroll handler reconciles the thumb/state.
 * SPEC.md §4.6: no-ops when the author already prevented the default action.
 */
export function scrollAreaScrollTo(
  event: ScrollAreaScrollToEvent,
  options: { position: 'end' | 'start' },
): ScrollAreaScrollToResult | undefined {
  if (event.defaultPrevented) return;

  const trigger = event.currentTarget ?? event.target ?? null;
  if (!trigger || typeof trigger.getAttribute !== 'function') return;

  const controls = trigger.getAttribute('aria-controls');
  const viewport =
    controls === null ? null : (trigger.ownerDocument?.getElementById(controls) ?? null);
  if (!viewport) return;

  const top = options.position === 'end' ? viewport.scrollHeight : 0;
  viewport.scrollTop = top;

  return { scrollTop: top, scrollY: options.position };
}

/**
 * Handles the scroll area track pointer down interaction for the Scroll Area primitive.
 *
 * @example
 * ```ts
 * import { scrollAreaTrackPointerDown } from '@kovojs/headless-ui/scroll-area';
 *
 * const input = {} as Parameters<typeof scrollAreaTrackPointerDown>[0];
 * const state = {} as Parameters<typeof scrollAreaTrackPointerDown>[1];
 * const options = {} as Parameters<typeof scrollAreaTrackPointerDown>[2];
 * const result = scrollAreaTrackPointerDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function scrollAreaTrackPointerDown(
  event: ScrollAreaPointerEvent,
  viewport: ScrollAreaViewportTarget,
  options: ScrollAreaThumbGeometryOptions = {},
): ScrollAreaViewportScrollResult | undefined {
  if (event.defaultPrevented) return;

  const orientation = scrollAreaOrientation(options.orientation);
  const trackSize = scrollAreaPointerTargetSize(event.target ?? event.currentTarget, orientation);
  const pointerOffset = scrollAreaPointerOffset(event, orientation);
  if (trackSize <= 0 || pointerOffset === undefined) return;

  const thumb = scrollAreaThumbGeometry(viewport, options);
  if (!thumb.visible) return scrollAreaViewportState(viewport, options);

  const thumbSize = thumb.sizeRatio * trackSize;
  const max =
    orientation === 'vertical'
      ? Math.max(
          0,
          finiteScrollNumber(viewport.scrollHeight) - finiteScrollNumber(viewport.clientHeight),
        )
      : Math.max(
          0,
          finiteScrollNumber(viewport.scrollWidth) - finiteScrollNumber(viewport.clientWidth),
        );
  const denominator = Math.max(1, trackSize - thumbSize);
  const ratio = Math.min(Math.max((pointerOffset - thumbSize / 2) / denominator, 0), 1);

  event.preventDefault();
  return scrollAreaViewportState(
    scrollAreaViewportWithOffset(viewport, orientation, ratio * max),
    options,
  );
}

/**
 * Computes scroll area thumb drag start for the Scroll Area primitive.
 *
 * @example
 * ```ts
 * import { scrollAreaThumbDragStart } from '@kovojs/headless-ui/scroll-area';
 *
 * const input = {} as Parameters<typeof scrollAreaThumbDragStart>[0];
 * const state = {} as Parameters<typeof scrollAreaThumbDragStart>[1];
 * const options = {} as Parameters<typeof scrollAreaThumbDragStart>[2];
 * const result = scrollAreaThumbDragStart(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function scrollAreaThumbDragStart(
  event: ScrollAreaPointerEvent,
  viewport: ScrollAreaViewportTarget,
  options: ScrollAreaThumbGeometryOptions = {},
): ScrollAreaThumbDragStart | undefined {
  if (event.defaultPrevented) return;

  const orientation = scrollAreaOrientation(options.orientation);
  const pointerStart = scrollAreaPointerClient(event, orientation);
  if (pointerStart === undefined) return;

  const thumbTarget = event.target ?? event.currentTarget;
  const trackTarget = thumbTarget?.parentElement ?? undefined;
  const trackSize = scrollAreaPointerTargetSize(trackTarget, orientation);
  const thumbSize =
    scrollAreaPointerTargetSize(thumbTarget, orientation) ||
    scrollAreaThumbGeometry(viewport, options).sizeRatio * trackSize;

  if (trackSize <= 0 || thumbSize <= 0) return;

  event.preventDefault();
  return Object.freeze({
    pointerStart,
    scrollStart: orientation === 'vertical' ? viewport.scrollTop : viewport.scrollLeft,
    thumbSize,
    trackSize,
  });
}

/**
 * Computes scroll area thumb drag for the Scroll Area primitive.
 *
 * @example
 * ```ts
 * import { scrollAreaThumbDrag } from '@kovojs/headless-ui/scroll-area';
 *
 * const input = {} as Parameters<typeof scrollAreaThumbDrag>[0];
 * const state = {} as Parameters<typeof scrollAreaThumbDrag>[1];
 * const options = {} as Parameters<typeof scrollAreaThumbDrag>[2];
 * const result = scrollAreaThumbDrag(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function scrollAreaThumbDrag(
  event: ScrollAreaPointerEvent,
  viewport: ScrollAreaViewportTarget,
  options: ScrollAreaThumbDragOptions,
): ScrollAreaViewportScrollResult | undefined {
  if (event.defaultPrevented) return;

  const orientation = scrollAreaOrientation(options.orientation);
  const pointer = scrollAreaPointerClient(event, orientation);
  if (pointer === undefined) return;

  const max =
    orientation === 'vertical'
      ? Math.max(
          0,
          finiteScrollNumber(viewport.scrollHeight) - finiteScrollNumber(viewport.clientHeight),
        )
      : Math.max(
          0,
          finiteScrollNumber(viewport.scrollWidth) - finiteScrollNumber(viewport.clientWidth),
        );
  const denominator = Math.max(
    1,
    finiteScrollNumber(options.trackSize) - finiteScrollNumber(options.thumbSize),
  );
  const offset =
    finiteScrollNumber(options.scrollStart) +
    ((pointer - options.pointerStart) / denominator) * max;

  event.preventDefault();
  return scrollAreaViewportState(
    scrollAreaViewportWithOffset(viewport, orientation, offset),
    options,
  );
}

function scrollAreaViewportEventTarget(
  event: ScrollAreaViewportScrollEvent,
): ScrollAreaViewportTarget | undefined {
  if (isScrollAreaViewportTarget(event.target)) return event.target;
  if (isScrollAreaViewportTarget(event.currentTarget)) return event.currentTarget;
  return undefined;
}

function isScrollAreaViewportTarget(value: unknown): value is ScrollAreaViewportTarget {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ScrollAreaViewportTarget).clientHeight === 'number' &&
    typeof (value as ScrollAreaViewportTarget).clientWidth === 'number' &&
    typeof (value as ScrollAreaViewportTarget).scrollHeight === 'number' &&
    typeof (value as ScrollAreaViewportTarget).scrollLeft === 'number' &&
    typeof (value as ScrollAreaViewportTarget).scrollTop === 'number' &&
    typeof (value as ScrollAreaViewportTarget).scrollWidth === 'number'
  );
}

function scrollAreaDataAttributes(state: ScrollAreaState): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataDisabled(state.disabled === true),
    {
      'data-scrollbars': scrollAreaScrollbars(state.scrollbars),
    },
    state.hasOverflowX === true ? { 'data-has-overflow-x': '' } : undefined,
    state.hasOverflowY === true ? { 'data-has-overflow-y': '' } : undefined,
    state.hovering === true ? { 'data-hovering': '' } : undefined,
    state.scrolling === true ? { 'data-scrolling': '' } : undefined,
  );
}

function scrollAreaViewportScrollDataAttributes(options: {
  scrollX?: ScrollAreaScrollPosition;
  scrollY?: ScrollAreaScrollPosition;
}): PrimitiveDataAttributes {
  return mergeDataAttributes(
    options.scrollX === undefined ? undefined : { 'data-scroll-x': options.scrollX },
    options.scrollY === undefined ? undefined : { 'data-scroll-y': options.scrollY },
  );
}

function scrollAreaPartDataAttributes(options: {
  disabled?: boolean;
  orientation: ScrollAreaOrientation;
  scrollPosition?: ScrollAreaScrollPosition;
  scrollbars?: ScrollAreaScrollbars;
  state: ScrollAreaVisibilityState;
}): PrimitiveDataAttributes {
  return mergeDataAttributes(
    scrollAreaDataAttributes(options),
    dataOrientation(options.orientation),
    dataState(options.state),
    options.scrollPosition === undefined
      ? undefined
      : { 'data-scroll-position': options.scrollPosition },
  );
}

function scrollAreaScrollbarEnabled(
  state: ScrollAreaState,
  orientation: ScrollAreaOrientation,
): boolean {
  const scrollbars = scrollAreaScrollbars(state.scrollbars);
  return scrollbars === 'both' || scrollbars === orientation;
}

function scrollAreaOrientation(
  orientation: ScrollAreaOrientation | undefined,
): ScrollAreaOrientation {
  return orientation === 'horizontal' ? 'horizontal' : 'vertical';
}

function scrollAreaScrollbars(scrollbars: ScrollAreaScrollbars | undefined): ScrollAreaScrollbars {
  return scrollbars ?? 'both';
}

function scrollAreaAxisState(
  scrollSize: number,
  clientSize: number,
  offset: number,
  state: ScrollAreaState,
  orientation: ScrollAreaOrientation,
): {
  max: number;
  offset: number;
  position: ScrollAreaScrollPosition;
  ratio: number;
} {
  const max = Math.max(0, finiteScrollNumber(scrollSize) - finiteScrollNumber(clientSize));
  if (state.disabled === true || !scrollAreaScrollbarEnabled(state, orientation) || max <= 0) {
    return { max, offset: 0, position: 'none', ratio: 0 };
  }

  const clampedOffset = Math.min(Math.max(finiteScrollNumber(offset), 0), max);
  const ratio = clampedOffset / max;

  if (ratio <= 0) return { max, offset: clampedOffset, position: 'start', ratio };
  if (ratio >= 1) return { max, offset: clampedOffset, position: 'end', ratio };
  return { max, offset: clampedOffset, position: 'middle', ratio };
}

function finiteScrollNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function scrollAreaViewportWithOffset(
  viewport: ScrollAreaViewportTarget,
  orientation: ScrollAreaOrientation,
  offset: number,
): ScrollAreaViewportTarget {
  const scrollTop =
    orientation === 'vertical'
      ? Math.min(
          Math.max(finiteScrollNumber(offset), 0),
          Math.max(
            0,
            finiteScrollNumber(viewport.scrollHeight) - finiteScrollNumber(viewport.clientHeight),
          ),
        )
      : viewport.scrollTop;
  const scrollLeft =
    orientation === 'horizontal'
      ? Math.min(
          Math.max(finiteScrollNumber(offset), 0),
          Math.max(
            0,
            finiteScrollNumber(viewport.scrollWidth) - finiteScrollNumber(viewport.clientWidth),
          ),
        )
      : viewport.scrollLeft;

  return {
    clientHeight: viewport.clientHeight,
    clientWidth: viewport.clientWidth,
    scrollHeight: viewport.scrollHeight,
    scrollLeft,
    scrollTop,
    scrollWidth: viewport.scrollWidth,
  };
}

function scrollAreaPointerTargetSize(
  target: ScrollAreaPointerTarget | null | undefined,
  orientation: ScrollAreaOrientation,
): number {
  const rect = target?.getBoundingClientRect?.();
  if (orientation === 'vertical') {
    return finiteScrollNumber(target?.clientHeight ?? rect?.height ?? 0);
  }

  return finiteScrollNumber(target?.clientWidth ?? rect?.width ?? 0);
}

function scrollAreaPointerOffset(
  event: ScrollAreaPointerEvent,
  orientation: ScrollAreaOrientation,
): number | undefined {
  const offset = orientation === 'vertical' ? event.offsetY : event.offsetX;
  if (typeof offset === 'number' && Number.isFinite(offset)) return offset;

  const target = event.target ?? event.currentTarget;
  const rect = target?.getBoundingClientRect?.();
  const pointer = scrollAreaPointerClient(event, orientation);
  if (rect === undefined || pointer === undefined) return undefined;

  return orientation === 'vertical' ? pointer - rect.top : pointer - rect.left;
}

function scrollAreaPointerClient(
  event: ScrollAreaPointerEvent,
  orientation: ScrollAreaOrientation,
): number | undefined {
  const value = orientation === 'vertical' ? event.clientY : event.clientX;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
