import {
  dataDisabled,
  dataOrientation,
  dataState,
  mergeDataAttributes,
  type PrimitiveDataAttributes,
  type TextDirection,
} from '../lib/index.js';

export type ScrollAreaOrientation = 'horizontal' | 'vertical';
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
}

export interface ScrollAreaScrollbarAttributeOptions extends ScrollAreaState {
  forceMount?: boolean;
  id?: string;
  orientation?: ScrollAreaOrientation;
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

function scrollAreaDataAttributes(state: ScrollAreaState): PrimitiveDataAttributes {
  return mergeDataAttributes(dataDisabled(state.disabled === true), {
    'data-scrollbars': scrollAreaScrollbars(state.scrollbars),
  });
}

function scrollAreaPartDataAttributes(options: {
  disabled?: boolean;
  orientation: ScrollAreaOrientation;
  scrollbars?: ScrollAreaScrollbars;
  state: ScrollAreaVisibilityState;
}): PrimitiveDataAttributes {
  return mergeDataAttributes(
    scrollAreaDataAttributes(options),
    dataOrientation(options.orientation),
    dataState(options.state),
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
