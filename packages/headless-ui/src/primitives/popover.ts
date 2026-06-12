import {
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  openState,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

export type PopoverChangeReason =
  | 'escape-key'
  | 'native-beforetoggle'
  | 'programmatic'
  | 'trigger-click';

export type PopoverChangeDetail = PrimitiveChangeDetail<PopoverChangeReason, boolean>;

export interface PopoverState {
  disabled?: boolean;
  open: boolean;
}

export interface PopoverAttributeOptions extends PopoverState {
  contentId?: string;
}

export interface PopoverChangeOptions {
  onOpenChange?: (detail: PopoverChangeDetail) => void;
}

export interface PopoverChangeResult {
  changed: boolean;
  detail?: PopoverChangeDetail;
  open: boolean;
}

export type PopoverPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

export type PopoverTriggerEvent = Event;

export type PopoverEscapeEvent = Event & Readonly<{ key?: string }>;

export type PopoverBeforeToggleEvent = Event &
  Readonly<{
    newState?: 'closed' | 'open';
  }>;

export function popoverRootAttributes(state: PopoverState): PopoverPrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(openState(state.open), dataDisabled(state.disabled === true)),
  });
}

export function popoverTriggerAttributes(
  options: PopoverAttributeOptions,
): PopoverPrimitiveAttributes {
  const enabledContentId = options.disabled === true ? undefined : options.contentId;

  return Object.freeze({
    ...mergeDataAttributes(openState(options.open), dataDisabled(options.disabled === true)),
    'aria-expanded': String(options.open),
    disabled: options.disabled === true,
    type: 'button',
    ...(enabledContentId === undefined
      ? {}
      : {
          'aria-controls': enabledContentId,
          popovertarget: enabledContentId,
          popovertargetaction: 'toggle',
        }),
  });
}

export function popoverContentAttributes(
  options: PopoverAttributeOptions,
): PopoverPrimitiveAttributes {
  return Object.freeze({
    ...openState(options.open),
    ...(options.contentId === undefined ? {} : { id: options.contentId }),
    popover: 'auto',
  });
}

export function setPopoverOpen(
  state: PopoverState,
  open: boolean,
  reason: PopoverChangeReason,
  options: PopoverChangeOptions = {},
): PopoverChangeResult {
  if (state.disabled || state.open === open) {
    return { changed: false, open: state.open };
  }

  const detail = dispatchCancelableChange({ reason, value: open }, options.onOpenChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, open: state.open };
  }

  return { changed: true, detail, open };
}

export function togglePopover(
  state: PopoverState,
  reason: PopoverChangeReason,
  options: PopoverChangeOptions = {},
): PopoverChangeResult {
  return setPopoverOpen(state, !state.open, reason, options);
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function popoverTriggerClick(
  event: PopoverTriggerEvent,
  state: PopoverState,
  options: PopoverChangeOptions = {},
): PopoverChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = togglePopover(state, 'trigger-click', options);
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
export function popoverBeforeToggle(
  event: PopoverBeforeToggleEvent,
  state: PopoverState,
  options: PopoverChangeOptions = {},
): PopoverChangeResult | undefined {
  if (event.defaultPrevented) return;
  if (event.newState !== 'open' && event.newState !== 'closed') return;

  const result = setPopoverOpen(state, event.newState === 'open', 'native-beforetoggle', options);
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
export function popoverEscapeKeyDown(
  event: PopoverEscapeEvent,
  state: PopoverState,
  options: PopoverChangeOptions = {},
): PopoverChangeResult | undefined {
  if (event.defaultPrevented) return;
  if (event.key !== 'Escape') return;

  const result = setPopoverOpen(state, false, 'escape-key', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}
