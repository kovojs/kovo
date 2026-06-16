import {
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  openState,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

export type TooltipChangeReason =
  | 'escape-key'
  | 'programmatic'
  | 'trigger-blur'
  | 'trigger-focus'
  | 'trigger-pointer-enter'
  | 'trigger-pointer-leave';

export type TooltipChangeDetail = PrimitiveChangeDetail<TooltipChangeReason, boolean>;

export interface TooltipState {
  disabled?: boolean;
  open: boolean;
}

export interface TooltipAttributeOptions extends TooltipState {
  contentId?: string;
}

export interface TooltipChangeOptions {
  onOpenChange?: (detail: TooltipChangeDetail) => void;
}

export interface TooltipChangeResult {
  changed: boolean;
  detail?: TooltipChangeDetail;
  open: boolean;
}

export type TooltipPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

export type TooltipTriggerEvent = Event;

export type TooltipEscapeEvent = Event & Readonly<{ key?: string }>;

export function tooltipRootAttributes(state: TooltipState): TooltipPrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(openState(state.open), dataDisabled(state.disabled === true)),
  });
}

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
