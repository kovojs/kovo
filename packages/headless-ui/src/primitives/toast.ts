import {
  dataDisabled,
  dataState,
  dispatchCancelableChange,
  mergeDataAttributes,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

export const toastShowEventName = 'toast:show' as const;
export const toastDismissEventName = 'toast:dismiss' as const;

export type ToastPlacement =
  | 'bottom-center'
  | 'bottom-end'
  | 'bottom-start'
  | 'top-center'
  | 'top-end'
  | 'top-start';

export type ToastPoliteness = 'assertive' | 'polite';

export type ToastVariant = 'default' | 'error' | 'info' | 'success' | 'warning';

export type ToastChangeReason =
  | 'action-click'
  | 'close-click'
  | 'escape-key'
  | 'programmatic'
  | 'timeout';

export interface ToastShowPayload {
  actionLabel?: string;
  actionValue?: string;
  description?: string;
  durationMs?: number;
  id?: string;
  politeness?: ToastPoliteness;
  title?: string;
  variant?: ToastVariant;
}

export interface ToastDismissPayload {
  id: string;
  reason?: ToastChangeReason;
}

export interface ToastEventDefinition<Name extends string, Payload> {
  name: Name;
  payload?: Payload;
  serverFactKeys?: readonly string[];
}

export type ToastShowEventDefinition = ToastEventDefinition<
  typeof toastShowEventName,
  ToastShowPayload
>;

export type ToastDismissEventDefinition = ToastEventDefinition<
  typeof toastDismissEventName,
  ToastDismissPayload
>;

export const toastShowEvent = Object.freeze({
  name: toastShowEventName,
}) as ToastShowEventDefinition;

export const toastDismissEvent = Object.freeze({
  name: toastDismissEventName,
}) as ToastDismissEventDefinition;

export const toastEvents = Object.freeze([toastShowEvent, toastDismissEvent] as const);

export interface ToastState {
  disabled?: boolean;
  id: string;
  open?: boolean;
}

export interface ToastViewportAttributeOptions {
  disabled?: boolean;
  id?: string;
  label?: string;
  placement?: ToastPlacement;
}

export interface ToastRootAttributeOptions extends ToastState {
  descriptionId?: string;
  politeness?: ToastPoliteness;
  titleId?: string;
  variant?: ToastVariant;
}

export interface ToastPartAttributeOptions {
  id?: string;
}

export interface ToastActionAttributeOptions extends ToastState {
  actionValue?: string;
  dismissOnAction?: boolean;
  variant?: ToastVariant;
}

export type ToastChangeValue = Readonly<{
  id: string;
  open: boolean;
}>;

export type ToastChangeDetail = PrimitiveChangeDetail<ToastChangeReason, ToastChangeValue>;

export interface ToastChangeOptions {
  dismissOnAction?: boolean;
  onOpenChange?: (detail: ToastChangeDetail) => void;
}

export interface ToastChangeResult {
  changed: boolean;
  detail?: ToastChangeDetail;
  id: string;
  open: boolean;
}

export type ToastPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type ToastButtonEvent = Event;
export type ToastKeyboardEvent = Event & { readonly key: string };

export function toastShowPayload(input: ToastShowPayload): ToastShowPayload {
  return Object.freeze({
    ...(input.actionLabel === undefined ? {} : { actionLabel: input.actionLabel }),
    ...(input.actionValue === undefined ? {} : { actionValue: input.actionValue }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.durationMs === undefined
      ? {}
      : { durationMs: normalizeToastDuration(input.durationMs) }),
    ...(input.id === undefined ? {} : { id: input.id }),
    ...(input.politeness === undefined ? {} : { politeness: toastPoliteness(input.politeness) }),
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.variant === undefined ? {} : { variant: toastVariant(input.variant) }),
  });
}

export function toastDismissPayload(input: ToastDismissPayload): ToastDismissPayload {
  return Object.freeze({
    id: input.id,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  });
}

export function toastViewportAttributes(
  options: ToastViewportAttributeOptions = {},
): ToastPrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(dataDisabled(options.disabled === true), {
      'data-placement': toastPlacement(options.placement),
    }),
    'aria-label': options.label ?? 'Notifications',
    role: 'region',
    tabIndex: -1,
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function toastRootAttributes(options: ToastRootAttributeOptions): ToastPrimitiveAttributes {
  const open = toastOpen(options);
  const politeness = toastPoliteness(options.politeness);

  return Object.freeze({
    ...toastDataAttributes(options),
    'aria-atomic': 'true',
    'aria-live': politeness,
    ...(options.descriptionId === undefined ? {} : { 'aria-describedby': options.descriptionId }),
    ...(options.titleId === undefined ? {} : { 'aria-labelledby': options.titleId }),
    ...(open ? {} : { hidden: true }),
    id: options.id,
    role: politeness === 'assertive' ? 'alert' : 'status',
  });
}

export function toastTitleAttributes(
  options: ToastPartAttributeOptions = {},
): ToastPrimitiveAttributes {
  return toastPartAttributes(options, 'title');
}

export function toastDescriptionAttributes(
  options: ToastPartAttributeOptions = {},
): ToastPrimitiveAttributes {
  return toastPartAttributes(options, 'description');
}

export function toastActionAttributes(
  options: ToastActionAttributeOptions,
): ToastPrimitiveAttributes {
  return Object.freeze({
    ...toastDataAttributes(options),
    'data-action': '',
    ...(options.dismissOnAction === false ? { 'data-dismiss-on-action': 'false' } : {}),
    disabled: options.disabled === true,
    type: 'button',
    ...(options.actionValue === undefined ? {} : { value: options.actionValue }),
  });
}

export function toastCloseAttributes(options: ToastState): ToastPrimitiveAttributes {
  return Object.freeze({
    ...toastDataAttributes(options),
    'data-dismiss': '',
    disabled: options.disabled === true,
    type: 'button',
  });
}

export function setToastOpen(
  state: ToastState,
  open: boolean,
  reason: ToastChangeReason,
  options: ToastChangeOptions = {},
): ToastChangeResult {
  const currentOpen = toastOpen(state);

  if (state.disabled || currentOpen === open) {
    return { changed: false, id: state.id, open: currentOpen };
  }

  const value = Object.freeze({ id: state.id, open });
  const detail = dispatchCancelableChange({ reason, value }, options.onOpenChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, id: state.id, open: currentOpen };
  }

  return { changed: true, detail, id: state.id, open };
}

export function dismissToast(
  state: ToastState,
  reason: ToastChangeReason,
  options: ToastChangeOptions = {},
): ToastChangeResult {
  return setToastOpen(state, false, reason, options);
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function toastCloseClick(
  event: ToastButtonEvent,
  state: ToastState,
  options: ToastChangeOptions = {},
): ToastChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = dismissToast(state, 'close-click', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function toastActionClick(
  event: ToastButtonEvent,
  state: ToastState,
  options: ToastChangeOptions = {},
): ToastChangeResult | undefined {
  if (event.defaultPrevented) return;

  if (state.disabled) {
    const open = toastOpen(state);
    event.preventDefault();
    return { changed: false, id: state.id, open };
  }

  if (options.dismissOnAction === false) {
    return { changed: false, id: state.id, open: toastOpen(state) };
  }

  const result = dismissToast(state, 'action-click', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function toastEscapeKeyDown(
  event: ToastKeyboardEvent,
  state: ToastState,
  options: ToastChangeOptions = {},
): ToastChangeResult | undefined {
  if (event.defaultPrevented) return;
  if (event.key !== 'Escape') return;

  const result = dismissToast(state, 'escape-key', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}

function toastPartAttributes(
  options: ToastPartAttributeOptions,
  part: 'description' | 'title',
): ToastPrimitiveAttributes {
  return Object.freeze({
    'data-part': part,
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

function toastDataAttributes(state: ToastRootAttributeOptions): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataState(toastOpen(state) ? 'open' : 'closed'),
    dataDisabled(state.disabled === true),
    { 'data-variant': toastVariant(state.variant) },
  );
}

function toastOpen(state: ToastState): boolean {
  return state.open !== false;
}

function toastPlacement(placement: ToastPlacement | undefined): ToastPlacement {
  return placement ?? 'bottom-end';
}

function toastPoliteness(politeness: ToastPoliteness | undefined): ToastPoliteness {
  return politeness ?? 'polite';
}

function toastVariant(variant: ToastVariant | undefined): ToastVariant {
  return variant ?? 'default';
}

function normalizeToastDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 0;
  return Math.round(durationMs);
}
