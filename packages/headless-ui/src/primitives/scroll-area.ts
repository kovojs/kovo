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

export type ScrollAreaViewportScrollEvent = Event & {
  readonly currentTarget: ScrollAreaViewportTarget | null;
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

  if (event.currentTarget === null) return;

  return scrollAreaViewportState(event.currentTarget, state);
}

function scrollAreaDataAttributes(state: ScrollAreaState): PrimitiveDataAttributes {
  return mergeDataAttributes(dataDisabled(state.disabled === true), {
    'data-scrollbars': scrollAreaScrollbars(state.scrollbars),
  });
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
