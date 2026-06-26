import {
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  openState,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

/**
 * Reason token reported by the Tooltip primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TooltipChangeReason } from '@kovojs/headless-ui/tooltip';
 *
 * const value: TooltipChangeReason = {} as TooltipChangeReason;
 * ```
 */
export type TooltipChangeReason =
  | 'escape-key'
  | 'programmatic'
  | 'trigger-blur'
  | 'trigger-focus'
  | 'trigger-pointer-enter'
  | 'trigger-pointer-leave';

/**
 * Cancelable change detail emitted by the Tooltip primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TooltipChangeDetail } from '@kovojs/headless-ui/tooltip';
 *
 * const value: TooltipChangeDetail = {} as TooltipChangeDetail;
 * ```
 */
export type TooltipChangeDetail = PrimitiveChangeDetail<TooltipChangeReason, boolean>;

/**
 * State snapshot consumed by the Tooltip primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TooltipState } from '@kovojs/headless-ui/tooltip';
 *
 * const value: TooltipState = {} as TooltipState;
 * ```
 */
export interface TooltipState {
  disabled?: boolean;
  open: boolean;
}

/**
 * Options accepted by the Tooltip primitive tooltip attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TooltipAttributeOptions } from '@kovojs/headless-ui/tooltip';
 *
 * const value: TooltipAttributeOptions = {} as TooltipAttributeOptions;
 * ```
 */
export interface TooltipAttributeOptions extends TooltipState {
  contentId?: string;
}

/**
 * Options accepted by the Tooltip primitive tooltip change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TooltipChangeOptions } from '@kovojs/headless-ui/tooltip';
 *
 * const value: TooltipChangeOptions = {} as TooltipChangeOptions;
 * ```
 */
export interface TooltipChangeOptions {
  onOpenChange?: (detail: TooltipChangeDetail) => void;
}

/**
 * Result returned by the Tooltip primitive tooltip change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TooltipChangeResult } from '@kovojs/headless-ui/tooltip';
 *
 * const value: TooltipChangeResult = {} as TooltipChangeResult;
 * ```
 */
export interface TooltipChangeResult {
  changed: boolean;
  detail?: TooltipChangeDetail;
  open: boolean;
}

/**
 * Serializable attribute record returned by Tooltip primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TooltipPrimitiveAttributes } from '@kovojs/headless-ui/tooltip';
 *
 * const value: TooltipPrimitiveAttributes = {} as TooltipPrimitiveAttributes;
 * ```
 */
export type TooltipPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

/**
 * Event shape consumed by the Tooltip primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TooltipTriggerEvent } from '@kovojs/headless-ui/tooltip';
 *
 * const value: TooltipTriggerEvent = {} as TooltipTriggerEvent;
 * ```
 */
export type TooltipTriggerEvent = Event;

/**
 * Event shape consumed by the Tooltip primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TooltipEscapeEvent } from '@kovojs/headless-ui/tooltip';
 *
 * const value: TooltipEscapeEvent = {} as TooltipEscapeEvent;
 * ```
 */
export type TooltipEscapeEvent = Event & Readonly<{ key?: string }>;

/**
 * Builds the tooltip root attributes record for the Tooltip primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { tooltipRootAttributes } from '@kovojs/headless-ui/tooltip';
 *
 * const input = {} as Parameters<typeof tooltipRootAttributes>[0];
 * const result = tooltipRootAttributes(input);
 * ```
 */
export function tooltipRootAttributes(state: TooltipState): TooltipPrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(openState(state.open), dataDisabled(state.disabled === true)),
  });
}

/**
 * Builds the tooltip trigger attributes record for the Tooltip primitive.
 *
 * Emits `aria-describedby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { tooltipTriggerAttributes } from '@kovojs/headless-ui/tooltip';
 *
 * const input = {} as Parameters<typeof tooltipTriggerAttributes>[0];
 * const result = tooltipTriggerAttributes(input);
 * ```
 */
export function tooltipTriggerAttributes(
  options: TooltipAttributeOptions,
): TooltipPrimitiveAttributes {
  const enabledContentId = options.disabled === true ? undefined : options.contentId;

  return Object.freeze({
    ...mergeDataAttributes(openState(options.open), dataDisabled(options.disabled === true)),
    ...(enabledContentId === undefined ? {} : { 'kovo-tooltip': enabledContentId }),
    ...(enabledContentId === undefined || !options.open
      ? {}
      : { 'aria-describedby': enabledContentId }),
  });
}

/**
 * Builds the tooltip content attributes record for the Tooltip primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { tooltipContentAttributes } from '@kovojs/headless-ui/tooltip';
 *
 * const input = {} as Parameters<typeof tooltipContentAttributes>[0];
 * const result = tooltipContentAttributes(input);
 * ```
 */
export function tooltipContentAttributes(
  options: TooltipAttributeOptions,
): TooltipPrimitiveAttributes {
  return Object.freeze({
    ...openState(options.open),
    hidden: !options.open,
    ...(options.contentId === undefined ? {} : { id: options.contentId }),
    role: 'tooltip',
  });
}

/**
 * Computes the set tooltip open transition for the Tooltip primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setTooltipOpen } from '@kovojs/headless-ui/tooltip';
 *
 * const input = {} as Parameters<typeof setTooltipOpen>[0];
 * const state = {} as Parameters<typeof setTooltipOpen>[1];
 * const options = {} as Parameters<typeof setTooltipOpen>[2];
 * const detail = {} as Parameters<typeof setTooltipOpen>[3];
 * const result = setTooltipOpen(input, state, options, detail);
 * ```
 */
export function setTooltipOpen(
  state: TooltipState,
  open: boolean,
  reason: TooltipChangeReason,
  options: TooltipChangeOptions = {},
): TooltipChangeResult {
  if (state.disabled || state.open === open) {
    return { changed: false, open: state.open };
  }

  const detail = dispatchCancelableChange({ reason, value: open }, options.onOpenChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, open: state.open };
  }

  return { changed: true, detail, open };
}

/**
 * Handles the tooltip trigger pointer enter interaction for the Tooltip primitive.
 *
 * @example
 * ```ts
 * import { tooltipTriggerPointerEnter } from '@kovojs/headless-ui/tooltip';
 *
 * const input = {} as Parameters<typeof tooltipTriggerPointerEnter>[0];
 * const state = {} as Parameters<typeof tooltipTriggerPointerEnter>[1];
 * const options = {} as Parameters<typeof tooltipTriggerPointerEnter>[2];
 * const result = tooltipTriggerPointerEnter(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function tooltipTriggerPointerEnter(
  event: TooltipTriggerEvent,
  state: TooltipState,
  options: TooltipChangeOptions = {},
): TooltipChangeResult | undefined {
  if (event.defaultPrevented) return;

  return setTooltipOpen(state, true, 'trigger-pointer-enter', options);
}

/**
 * Handles the tooltip trigger pointer leave interaction for the Tooltip primitive.
 *
 * @example
 * ```ts
 * import { tooltipTriggerPointerLeave } from '@kovojs/headless-ui/tooltip';
 *
 * const input = {} as Parameters<typeof tooltipTriggerPointerLeave>[0];
 * const state = {} as Parameters<typeof tooltipTriggerPointerLeave>[1];
 * const options = {} as Parameters<typeof tooltipTriggerPointerLeave>[2];
 * const result = tooltipTriggerPointerLeave(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function tooltipTriggerPointerLeave(
  event: TooltipTriggerEvent,
  state: TooltipState,
  options: TooltipChangeOptions = {},
): TooltipChangeResult | undefined {
  if (event.defaultPrevented) return;

  return setTooltipOpen(state, false, 'trigger-pointer-leave', options);
}

/**
 * Handles the tooltip trigger focus interaction for the Tooltip primitive.
 *
 * @example
 * ```ts
 * import { tooltipTriggerFocus } from '@kovojs/headless-ui/tooltip';
 *
 * const input = {} as Parameters<typeof tooltipTriggerFocus>[0];
 * const state = {} as Parameters<typeof tooltipTriggerFocus>[1];
 * const options = {} as Parameters<typeof tooltipTriggerFocus>[2];
 * const result = tooltipTriggerFocus(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function tooltipTriggerFocus(
  event: TooltipTriggerEvent,
  state: TooltipState,
  options: TooltipChangeOptions = {},
): TooltipChangeResult | undefined {
  if (event.defaultPrevented) return;

  return setTooltipOpen(state, true, 'trigger-focus', options);
}

/**
 * Handles the tooltip trigger blur interaction for the Tooltip primitive.
 *
 * @example
 * ```ts
 * import { tooltipTriggerBlur } from '@kovojs/headless-ui/tooltip';
 *
 * const input = {} as Parameters<typeof tooltipTriggerBlur>[0];
 * const state = {} as Parameters<typeof tooltipTriggerBlur>[1];
 * const options = {} as Parameters<typeof tooltipTriggerBlur>[2];
 * const result = tooltipTriggerBlur(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function tooltipTriggerBlur(
  event: TooltipTriggerEvent,
  state: TooltipState,
  options: TooltipChangeOptions = {},
): TooltipChangeResult | undefined {
  if (event.defaultPrevented) return;

  return setTooltipOpen(state, false, 'trigger-blur', options);
}

/**
 * Handles the tooltip escape key down interaction for the Tooltip primitive.
 *
 * @example
 * ```ts
 * import { tooltipEscapeKeyDown } from '@kovojs/headless-ui/tooltip';
 *
 * const input = {} as Parameters<typeof tooltipEscapeKeyDown>[0];
 * const state = {} as Parameters<typeof tooltipEscapeKeyDown>[1];
 * const options = {} as Parameters<typeof tooltipEscapeKeyDown>[2];
 * const result = tooltipEscapeKeyDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function tooltipEscapeKeyDown(
  event: TooltipEscapeEvent,
  state: TooltipState,
  options: TooltipChangeOptions = {},
): TooltipChangeResult | undefined {
  if (event.defaultPrevented) return;
  if (event.key !== 'Escape') return;

  const result = setTooltipOpen(state, false, 'escape-key', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}
