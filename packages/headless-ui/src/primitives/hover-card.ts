import {
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  openState,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

export type HoverCardChangeReason =
  | 'content-blur'
  | 'content-focus'
  | 'content-pointer-enter'
  | 'content-pointer-leave'
  | 'escape-key'
  | 'programmatic'
  | 'trigger-blur'
  | 'trigger-focus'
  | 'trigger-pointer-enter'
  | 'trigger-pointer-leave';

export type HoverCardChangeDetail = PrimitiveChangeDetail<HoverCardChangeReason, boolean>;

export interface HoverCardState {
  disabled?: boolean;
  open: boolean;
}

export interface HoverCardAttributeOptions extends HoverCardState {
  contentId?: string;
}

export interface HoverCardChangeOptions {
  onOpenChange?: (detail: HoverCardChangeDetail) => void;
}

export interface HoverCardChangeResult {
  changed: boolean;
  detail?: HoverCardChangeDetail;
  open: boolean;
}

export type HoverCardPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

export type HoverCardTriggerEvent = Event;

export type HoverCardContentEvent = Event;

export type HoverCardEscapeEvent = Event & Readonly<{ key?: string }>;

export function hoverCardRootAttributes(state: HoverCardState): HoverCardPrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(openState(state.open), dataDisabled(state.disabled === true)),
  });
}

export function hoverCardTriggerAttributes(
  options: HoverCardAttributeOptions,
): HoverCardPrimitiveAttributes {
  const enabledContentId = options.disabled === true ? undefined : options.contentId;

  return Object.freeze({
    ...mergeDataAttributes(openState(options.open), dataDisabled(options.disabled === true)),
    'aria-expanded': String(options.open),
    ...(enabledContentId === undefined
      ? {}
      : {
          'aria-controls': enabledContentId,
          'jiso-hover-card': enabledContentId,
        }),
  });
}

export function hoverCardContentAttributes(
  options: HoverCardAttributeOptions,
): HoverCardPrimitiveAttributes {
  return Object.freeze({
    ...openState(options.open),
    hidden: !options.open,
    ...(options.contentId === undefined ? {} : { id: options.contentId }),
    popover: 'manual',
  });
}

export function setHoverCardOpen(
  state: HoverCardState,
  open: boolean,
  reason: HoverCardChangeReason,
  options: HoverCardChangeOptions = {},
): HoverCardChangeResult {
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
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function hoverCardTriggerPointerEnter(
  event: HoverCardTriggerEvent,
  state: HoverCardState,
  options: HoverCardChangeOptions = {},
): HoverCardChangeResult | undefined {
  if (event.defaultPrevented) return;

  return setHoverCardOpen(state, true, 'trigger-pointer-enter', options);
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function hoverCardTriggerPointerLeave(
  event: HoverCardTriggerEvent,
  state: HoverCardState,
  options: HoverCardChangeOptions = {},
): HoverCardChangeResult | undefined {
  if (event.defaultPrevented) return;

  return setHoverCardOpen(state, false, 'trigger-pointer-leave', options);
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function hoverCardTriggerFocus(
  event: HoverCardTriggerEvent,
  state: HoverCardState,
  options: HoverCardChangeOptions = {},
): HoverCardChangeResult | undefined {
  if (event.defaultPrevented) return;

  return setHoverCardOpen(state, true, 'trigger-focus', options);
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function hoverCardTriggerBlur(
  event: HoverCardTriggerEvent,
  state: HoverCardState,
  options: HoverCardChangeOptions = {},
): HoverCardChangeResult | undefined {
  if (event.defaultPrevented) return;

  return setHoverCardOpen(state, false, 'trigger-blur', options);
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function hoverCardContentPointerEnter(
  event: HoverCardContentEvent,
  state: HoverCardState,
  options: HoverCardChangeOptions = {},
): HoverCardChangeResult | undefined {
  if (event.defaultPrevented) return;

  return setHoverCardOpen(state, true, 'content-pointer-enter', options);
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function hoverCardContentPointerLeave(
  event: HoverCardContentEvent,
  state: HoverCardState,
  options: HoverCardChangeOptions = {},
): HoverCardChangeResult | undefined {
  if (event.defaultPrevented) return;

  return setHoverCardOpen(state, false, 'content-pointer-leave', options);
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function hoverCardContentFocus(
  event: HoverCardContentEvent,
  state: HoverCardState,
  options: HoverCardChangeOptions = {},
): HoverCardChangeResult | undefined {
  if (event.defaultPrevented) return;

  return setHoverCardOpen(state, true, 'content-focus', options);
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function hoverCardContentBlur(
  event: HoverCardContentEvent,
  state: HoverCardState,
  options: HoverCardChangeOptions = {},
): HoverCardChangeResult | undefined {
  if (event.defaultPrevented) return;

  return setHoverCardOpen(state, false, 'content-blur', options);
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function hoverCardEscapeKeyDown(
  event: HoverCardEscapeEvent,
  state: HoverCardState,
  options: HoverCardChangeOptions = {},
): HoverCardChangeResult | undefined {
  if (event.defaultPrevented) return;
  if (event.key !== 'Escape') return;

  const result = setHoverCardOpen(state, false, 'escape-key', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}
