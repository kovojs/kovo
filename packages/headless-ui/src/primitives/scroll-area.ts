import {
  dataDisabled,
  dataOrientation,
  dataState,
  mergeDataAttributes,
  type PrimitiveDataAttributes,
  type TextDirection,
} from '../lib/index.js';

export type ScrollAreaOrientation = 'horizontal' | 'vertical';
export type ScrollAreaScrollPosition = 'end' | 'middle' | 'none' | 'start';
export type ScrollAreaScrollbars = 'both' | 'horizontal' | 'none' | 'vertical';
export type ScrollAreaVisibilityState = 'hidden' | 'visible';

export interface ScrollAreaState {
  disabled?: boolean;
  dir?: TextDirection;
  hasOverflowX?: boolean;
  hasOverflowY?: boolean;
  hovering?: boolean;
  scrolling?: boolean;
  scrollbars?: ScrollAreaScrollbars;
}

export interface ScrollAreaRootAttributeOptions extends ScrollAreaState {
  id?: string;
}

export interface ScrollAreaViewportAttributeOptions extends ScrollAreaState {
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
  scrollX?: ScrollAreaScrollPosition;
  scrollY?: ScrollAreaScrollPosition;
}

export interface ScrollAreaScrollbarAttributeOptions extends ScrollAreaState {
  forceMount?: boolean;
  id?: string;
  orientation?: ScrollAreaOrientation;
  scrollPosition?: ScrollAreaScrollPosition;
  visible?: boolean;
}

export interface ScrollAreaThumbAttributeOptions extends ScrollAreaScrollbarAttributeOptions {}

export interface ScrollAreaCornerAttributeOptions extends ScrollAreaState {
  forceMount?: boolean;
  id?: string;
  visible?: boolean;
}

export type ScrollAreaPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export interface ScrollAreaViewportTarget {
  readonly clientHeight: number;
  readonly clientWidth: number;
  readonly scrollHeight: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly scrollWidth: number;
}

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

export interface ScrollAreaThumbGeometryOptions extends ScrollAreaState {
  orientation?: ScrollAreaOrientation;
}

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

export type ScrollAreaViewportScrollResult = ScrollAreaViewportComputedState;

export interface ScrollAreaThumbGeometry {
  readonly offsetRatio: number;
  readonly scrollPosition: ScrollAreaScrollPosition;
  readonly sizeRatio: number;
  readonly visible: boolean;
}

export interface ScrollAreaThumbDragStart {
  readonly pointerStart: number;
  readonly scrollStart: number;
  readonly thumbSize: number;
  readonly trackSize: number;
}

export interface ScrollAreaThumbDragOptions extends ScrollAreaState {
  orientation?: ScrollAreaOrientation;
  pointerStart: number;
  scrollStart: number;
  thumbSize: number;
  trackSize: number;
}

export type ScrollAreaViewportScrollEvent = Event & {
  readonly currentTarget: ScrollAreaViewportTarget | null;
  readonly target?: Partial<ScrollAreaViewportTarget> | null;
};

export type ScrollAreaPointerEvent = Event & {
  readonly clientX?: number;
  readonly clientY?: number;
  readonly currentTarget?: ScrollAreaPointerTarget | null;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly target?: ScrollAreaPointerTarget | null;
};

export function scrollAreaRootAttributes(
  options: ScrollAreaRootAttributeOptions = {},
): ScrollAreaPrimitiveAttributes {
  return Object.freeze({
    ...scrollAreaDataAttributes(options),
    ...(options.dir === undefined ? {} : { dir: options.dir }),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

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

export function scrollAreaScrollbarState(
  options: ScrollAreaScrollbarAttributeOptions = {},
): ScrollAreaVisibilityState {
  if (options.disabled === true) return 'hidden';
  if (!scrollAreaScrollbarEnabled(options, scrollAreaOrientation(options.orientation))) {
    return 'hidden';
  }

  return options.visible === false ? 'hidden' : 'visible';
}

export function scrollAreaCornerState(
  options: ScrollAreaCornerAttributeOptions = {},
): ScrollAreaVisibilityState {
  if (options.disabled === true) return 'hidden';
  if (scrollAreaScrollbars(options.scrollbars) !== 'both') return 'hidden';

  return options.visible === false ? 'hidden' : 'visible';
}

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
  const visible = orientation === 'vertical' ? viewport.verticalVisible : viewport.horizontalVisible;

  return Object.freeze({
    offsetRatio: orientation === 'vertical' ? viewport.scrollYRatio : viewport.scrollXRatio,
    scrollPosition: orientation === 'vertical' ? viewport.scrollY : viewport.scrollX,
    sizeRatio: visible && scrollSize > 0 ? Math.min(1, Math.max(0, clientSize / scrollSize)) : 0,
    visible,
  });
}

/**
 * @jisoPrimitiveHandler
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
 * @jisoPrimitiveHandler
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
  const trackSize = scrollAreaPointerTargetSize(
    event.target ?? event.currentTarget,
    orientation,
  );
  const pointerOffset = scrollAreaPointerOffset(event, orientation);
  if (trackSize <= 0 || pointerOffset === undefined) return;

  const thumb = scrollAreaThumbGeometry(viewport, options);
  if (!thumb.visible) return scrollAreaViewportState(viewport, options);

  const thumbSize = thumb.sizeRatio * trackSize;
  const max =
    orientation === 'vertical'
      ? Math.max(0, finiteScrollNumber(viewport.scrollHeight) - finiteScrollNumber(viewport.clientHeight))
      : Math.max(0, finiteScrollNumber(viewport.scrollWidth) - finiteScrollNumber(viewport.clientWidth));
  const denominator = Math.max(1, trackSize - thumbSize);
  const ratio = Math.min(Math.max((pointerOffset - thumbSize / 2) / denominator, 0), 1);

  event.preventDefault();
  return scrollAreaViewportState(
    scrollAreaViewportWithOffset(viewport, orientation, ratio * max),
    options,
  );
}

/**
 * @jisoPrimitiveHandler
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
 * @jisoPrimitiveHandler
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
      ? Math.max(0, finiteScrollNumber(viewport.scrollHeight) - finiteScrollNumber(viewport.clientHeight))
      : Math.max(0, finiteScrollNumber(viewport.scrollWidth) - finiteScrollNumber(viewport.clientWidth));
  const denominator = Math.max(1, finiteScrollNumber(options.trackSize) - finiteScrollNumber(options.thumbSize));
  const offset = finiteScrollNumber(options.scrollStart) + ((pointer - options.pointerStart) / denominator) * max;

  event.preventDefault();
  return scrollAreaViewportState(scrollAreaViewportWithOffset(viewport, orientation, offset), options);
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
          Math.max(0, finiteScrollNumber(viewport.scrollHeight) - finiteScrollNumber(viewport.clientHeight)),
        )
      : viewport.scrollTop;
  const scrollLeft =
    orientation === 'horizontal'
      ? Math.min(
          Math.max(finiteScrollNumber(offset), 0),
          Math.max(0, finiteScrollNumber(viewport.scrollWidth) - finiteScrollNumber(viewport.clientWidth)),
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
