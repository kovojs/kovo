import {
  dataDisabled,
  dataState,
  dispatchCancelableChange,
  mergeDataAttributes,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

/**
 * Public value used by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toastShowEventName } from '@kovojs/headless-ui/toast';
 *
 * const value = toastShowEventName;
 * ```
 */
export const toastShowEventName = 'toast:show' as const;

/**
 * Public value used by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toastDismissEventName } from '@kovojs/headless-ui/toast';
 *
 * const value = toastDismissEventName;
 * ```
 */
export const toastDismissEventName = 'toast:dismiss' as const;

/**
 * Public type used by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastPlacement } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastPlacement = {} as ToastPlacement;
 * ```
 */
export type ToastPlacement =
  | 'bottom-center'
  | 'bottom-end'
  | 'bottom-start'
  | 'top-center'
  | 'top-end'
  | 'top-start';

/**
 * Public type used by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastPoliteness } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastPoliteness = {} as ToastPoliteness;
 * ```
 */
export type ToastPoliteness = 'assertive' | 'polite';

/**
 * Public type used by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastVariant } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastVariant = {} as ToastVariant;
 * ```
 */
export type ToastVariant = 'default' | 'error' | 'info' | 'success' | 'warning';

/**
 * Reason token reported by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastChangeReason } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastChangeReason = {} as ToastChangeReason;
 * ```
 */
export type ToastChangeReason =
  | 'action-click'
  | 'close-click'
  | 'escape-key'
  | 'programmatic'
  | 'timeout';

/**
 * Public interface used by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastShowPayload } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastShowPayload = {} as ToastShowPayload;
 * ```
 */
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

/**
 * Public interface used by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastDismissPayload } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastDismissPayload = {} as ToastDismissPayload;
 * ```
 */
export interface ToastDismissPayload {
  id: string;
  reason?: ToastChangeReason;
}

/**
 * Public interface used by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastEventDefinition } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastEventDefinition = {} as ToastEventDefinition;
 * ```
 */
export interface ToastEventDefinition<Name extends string, Payload> {
  name: Name;
  payload?: Payload;
  serverFactKeys?: readonly string[];
}

/**
 * Public type used by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastShowEventDefinition } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastShowEventDefinition = {} as ToastShowEventDefinition;
 * ```
 */
export type ToastShowEventDefinition = ToastEventDefinition<
  typeof toastShowEventName,
  ToastShowPayload
>;

/**
 * Public type used by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastDismissEventDefinition } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastDismissEventDefinition = {} as ToastDismissEventDefinition;
 * ```
 */
export type ToastDismissEventDefinition = ToastEventDefinition<
  typeof toastDismissEventName,
  ToastDismissPayload
>;

/**
 * Event shape consumed by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toastShowEvent } from '@kovojs/headless-ui/toast';
 *
 * const value = toastShowEvent;
 * ```
 */
export const toastShowEvent = Object.freeze({
  name: toastShowEventName,
}) as ToastShowEventDefinition;

/**
 * Event shape consumed by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toastDismissEvent } from '@kovojs/headless-ui/toast';
 *
 * const value = toastDismissEvent;
 * ```
 */
export const toastDismissEvent = Object.freeze({
  name: toastDismissEventName,
}) as ToastDismissEventDefinition;

/**
 * Public value used by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toastEvents } from '@kovojs/headless-ui/toast';
 *
 * const value = toastEvents;
 * ```
 */
export const toastEvents = Object.freeze([toastShowEvent, toastDismissEvent] as const);

/**
 * State snapshot consumed by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastState } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastState = {} as ToastState;
 * ```
 */
export interface ToastState {
  disabled?: boolean;
  id: string;
  open?: boolean;
}

/**
 * Options accepted by the Toast primitive toast viewport attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastViewportAttributeOptions } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastViewportAttributeOptions = {} as ToastViewportAttributeOptions;
 * ```
 */
export interface ToastViewportAttributeOptions {
  disabled?: boolean;
  id?: string;
  label?: string;
  placement?: ToastPlacement;
}

/**
 * Options accepted by the Toast primitive toast root attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastRootAttributeOptions } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastRootAttributeOptions = {} as ToastRootAttributeOptions;
 * ```
 */
export interface ToastRootAttributeOptions extends ToastState {
  descriptionId?: string;
  politeness?: ToastPoliteness;
  titleId?: string;
  variant?: ToastVariant;
}

/**
 * Options accepted by the Toast primitive toast part attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastPartAttributeOptions } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastPartAttributeOptions = {} as ToastPartAttributeOptions;
 * ```
 */
export interface ToastPartAttributeOptions {
  id?: string;
}

/**
 * Options accepted by the Toast primitive toast action attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastActionAttributeOptions } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastActionAttributeOptions = {} as ToastActionAttributeOptions;
 * ```
 */
export interface ToastActionAttributeOptions extends ToastState {
  actionValue?: string;
  dismissOnAction?: boolean;
  variant?: ToastVariant;
}

/**
 * Public type used by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastChangeValue } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastChangeValue = {} as ToastChangeValue;
 * ```
 */
export type ToastChangeValue = Readonly<{
  id: string;
  open: boolean;
}>;

/**
 * Cancelable change detail emitted by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastChangeDetail } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastChangeDetail = {} as ToastChangeDetail;
 * ```
 */
export type ToastChangeDetail = PrimitiveChangeDetail<ToastChangeReason, ToastChangeValue>;

/**
 * Options accepted by the Toast primitive toast change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastChangeOptions } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastChangeOptions = {} as ToastChangeOptions;
 * ```
 */
export interface ToastChangeOptions {
  dismissOnAction?: boolean;
  onOpenChange?: (detail: ToastChangeDetail) => void;
}

/**
 * Result returned by the Toast primitive toast change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastChangeResult } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastChangeResult = {} as ToastChangeResult;
 * ```
 */
export interface ToastChangeResult {
  changed: boolean;
  detail?: ToastChangeDetail;
  id: string;
  open: boolean;
}

/**
 * Serializable attribute record returned by Toast primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastPrimitiveAttributes } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastPrimitiveAttributes = {} as ToastPrimitiveAttributes;
 * ```
 */
export type ToastPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

/**
 * Event shape consumed by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastButtonEvent } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastButtonEvent = {} as ToastButtonEvent;
 * ```
 */
export type ToastButtonEvent = Event;

/**
 * Event shape consumed by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastAnimationEvent } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastAnimationEvent = {} as ToastAnimationEvent;
 * ```
 */
export type ToastAnimationEvent = Event & { readonly animationName?: string };

/**
 * Event shape consumed by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastKeyboardEvent } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastKeyboardEvent = {} as ToastKeyboardEvent;
 * ```
 */
export type ToastKeyboardEvent = Event & { readonly key: string };

/**
 * Event shape consumed by the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToastViewportKeyboardEvent } from '@kovojs/headless-ui/toast';
 *
 * const value: ToastViewportKeyboardEvent = {} as ToastViewportKeyboardEvent;
 * ```
 */
export type ToastViewportKeyboardEvent = Event & { readonly key: string };

/**
 * Computes toast show payload for the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toastShowPayload } from '@kovojs/headless-ui/toast';
 *
 * const input = {} as Parameters<typeof toastShowPayload>[0];
 * const result = toastShowPayload(input);
 * ```
 */
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

/**
 * Computes toast dismiss payload for the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toastDismissPayload } from '@kovojs/headless-ui/toast';
 *
 * const input = {} as Parameters<typeof toastDismissPayload>[0];
 * const result = toastDismissPayload(input);
 * ```
 */
export function toastDismissPayload(input: ToastDismissPayload): ToastDismissPayload {
  return Object.freeze({
    id: input.id,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  });
}

/**
 * Builds the toast viewport attributes record for the Toast primitive.
 *
 * Emits `aria-label`, `data-placement`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toastViewportAttributes } from '@kovojs/headless-ui/toast';
 *
 * const input = {} as Parameters<typeof toastViewportAttributes>[0];
 * const result = toastViewportAttributes(input);
 * ```
 */
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

/**
 * Builds the toast root attributes record for the Toast primitive.
 *
 * Emits `aria-atomic`, `aria-describedby`, `aria-labelledby`, `aria-live`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toastRootAttributes } from '@kovojs/headless-ui/toast';
 *
 * const input = {} as Parameters<typeof toastRootAttributes>[0];
 * const result = toastRootAttributes(input);
 * ```
 */
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

/**
 * Builds the toast title attributes record for the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toastTitleAttributes } from '@kovojs/headless-ui/toast';
 *
 * const input = {} as Parameters<typeof toastTitleAttributes>[0];
 * const result = toastTitleAttributes(input);
 * ```
 */
export function toastTitleAttributes(
  options: ToastPartAttributeOptions = {},
): ToastPrimitiveAttributes {
  return toastPartAttributes(options, 'title');
}

/**
 * Builds the toast description attributes record for the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toastDescriptionAttributes } from '@kovojs/headless-ui/toast';
 *
 * const input = {} as Parameters<typeof toastDescriptionAttributes>[0];
 * const result = toastDescriptionAttributes(input);
 * ```
 */
export function toastDescriptionAttributes(
  options: ToastPartAttributeOptions = {},
): ToastPrimitiveAttributes {
  return toastPartAttributes(options, 'description');
}

/**
 * Builds the toast action attributes record for the Toast primitive.
 *
 * Emits `data-action`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toastActionAttributes } from '@kovojs/headless-ui/toast';
 *
 * const input = {} as Parameters<typeof toastActionAttributes>[0];
 * const result = toastActionAttributes(input);
 * ```
 */
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

/**
 * Builds the toast close attributes record for the Toast primitive.
 *
 * Emits `data-dismiss`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toastCloseAttributes } from '@kovojs/headless-ui/toast';
 *
 * const input = {} as Parameters<typeof toastCloseAttributes>[0];
 * const result = toastCloseAttributes(input);
 * ```
 */
export function toastCloseAttributes(options: ToastState): ToastPrimitiveAttributes {
  return Object.freeze({
    ...toastDataAttributes(options),
    'data-dismiss': '',
    disabled: options.disabled === true,
    type: 'button',
  });
}

/**
 * Computes the set toast open transition for the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setToastOpen } from '@kovojs/headless-ui/toast';
 *
 * const input = {} as Parameters<typeof setToastOpen>[0];
 * const state = {} as Parameters<typeof setToastOpen>[1];
 * const options = {} as Parameters<typeof setToastOpen>[2];
 * const detail = {} as Parameters<typeof setToastOpen>[3];
 * const result = setToastOpen(input, state, options, detail);
 * ```
 */
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

/**
 * Computes the dismiss toast transition for the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { dismissToast } from '@kovojs/headless-ui/toast';
 *
 * const input = {} as Parameters<typeof dismissToast>[0];
 * const state = {} as Parameters<typeof dismissToast>[1];
 * const options = {} as Parameters<typeof dismissToast>[2];
 * const result = dismissToast(input, state, options);
 * ```
 */
export function dismissToast(
  state: ToastState,
  reason: ToastChangeReason,
  options: ToastChangeOptions = {},
): ToastChangeResult {
  return setToastOpen(state, false, reason, options);
}

/**
 * Handles the toast close click interaction for the Toast primitive.
 *
 * @example
 * ```ts
 * import { toastCloseClick } from '@kovojs/headless-ui/toast';
 *
 * const input = {} as Parameters<typeof toastCloseClick>[0];
 * const state = {} as Parameters<typeof toastCloseClick>[1];
 * const options = {} as Parameters<typeof toastCloseClick>[2];
 * const result = toastCloseClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the toast action click interaction for the Toast primitive.
 *
 * @example
 * ```ts
 * import { toastActionClick } from '@kovojs/headless-ui/toast';
 *
 * const input = {} as Parameters<typeof toastActionClick>[0];
 * const state = {} as Parameters<typeof toastActionClick>[1];
 * const options = {} as Parameters<typeof toastActionClick>[2];
 * const result = toastActionClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the toast escape key down interaction for the Toast primitive.
 *
 * @example
 * ```ts
 * import { toastEscapeKeyDown } from '@kovojs/headless-ui/toast';
 *
 * const input = {} as Parameters<typeof toastEscapeKeyDown>[0];
 * const state = {} as Parameters<typeof toastEscapeKeyDown>[1];
 * const options = {} as Parameters<typeof toastEscapeKeyDown>[2];
 * const result = toastEscapeKeyDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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

/**
 * Handles the toast animation end interaction for the Toast primitive.
 *
 * @example
 * ```ts
 * import { toastAnimationEnd } from '@kovojs/headless-ui/toast';
 *
 * const input = {} as Parameters<typeof toastAnimationEnd>[0];
 * const state = {} as Parameters<typeof toastAnimationEnd>[1];
 * const options = {} as Parameters<typeof toastAnimationEnd>[2];
 * const detail = {} as Parameters<typeof toastAnimationEnd>[3];
 * const result = toastAnimationEnd(input, state, options, detail);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function toastAnimationEnd(
  event: ToastAnimationEvent,
  state: ToastState,
  animationName = 'kovo-toast-auto-dismiss',
  options: ToastChangeOptions = {},
): ToastChangeResult | undefined {
  if (event.defaultPrevented) return;
  if (event.animationName !== animationName) return;

  const result = dismissToast(state, 'timeout', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}

/**
 * Handles the toast viewport key down interaction for the Toast primitive.
 *
 * @example
 * ```ts
 * import { toastViewportKeyDown } from '@kovojs/headless-ui/toast';
 *
 * const input = {} as Parameters<typeof toastViewportKeyDown>[0];
 * const result = toastViewportKeyDown(input);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function toastViewportKeyDown(event: ToastViewportKeyboardEvent): boolean | undefined {
  if (event.defaultPrevented) return;
  if (event.key !== 'F6') return;

  (event.currentTarget as { focus?: () => void } | null)?.focus?.();
  event.preventDefault();
  return true;
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

/**
 * Computes normalize toast duration for the Toast primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { normalizeToastDuration } from '@kovojs/headless-ui/toast';
 *
 * const input = {} as Parameters<typeof normalizeToastDuration>[0];
 * const result = normalizeToastDuration(input);
 * ```
 */
export function normalizeToastDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 0;
  return Math.round(durationMs);
}
