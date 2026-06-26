import {
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  openState,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

/**
 * Reason token reported by the Popover primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { PopoverChangeReason } from '@kovojs/headless-ui/popover';
 *
 * const value: PopoverChangeReason = {} as PopoverChangeReason;
 * ```
 */
export type PopoverChangeReason =
  | 'escape-key'
  | 'native-beforetoggle'
  | 'programmatic'
  | 'trigger-click';

/**
 * Cancelable change detail emitted by the Popover primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { PopoverChangeDetail } from '@kovojs/headless-ui/popover';
 *
 * const value: PopoverChangeDetail = {} as PopoverChangeDetail;
 * ```
 */
export type PopoverChangeDetail = PrimitiveChangeDetail<PopoverChangeReason, boolean>;

/**
 * State snapshot consumed by the Popover primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { PopoverState } from '@kovojs/headless-ui/popover';
 *
 * const value: PopoverState = {} as PopoverState;
 * ```
 */
export interface PopoverState {
  disabled?: boolean;
  open: boolean;
}

/**
 * Options accepted by the Popover primitive popover attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { PopoverAttributeOptions } from '@kovojs/headless-ui/popover';
 *
 * const value: PopoverAttributeOptions = {} as PopoverAttributeOptions;
 * ```
 */
export interface PopoverAttributeOptions extends PopoverState {
  contentId?: string;
}

/**
 * Options accepted by the Popover primitive popover change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { PopoverChangeOptions } from '@kovojs/headless-ui/popover';
 *
 * const value: PopoverChangeOptions = {} as PopoverChangeOptions;
 * ```
 */
export interface PopoverChangeOptions {
  onOpenChange?: (detail: PopoverChangeDetail) => void;
}

/**
 * Result returned by the Popover primitive popover change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { PopoverChangeResult } from '@kovojs/headless-ui/popover';
 *
 * const value: PopoverChangeResult = {} as PopoverChangeResult;
 * ```
 */
export interface PopoverChangeResult {
  changed: boolean;
  detail?: PopoverChangeDetail;
  open: boolean;
}

/**
 * Serializable attribute record returned by Popover primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { PopoverPrimitiveAttributes } from '@kovojs/headless-ui/popover';
 *
 * const value: PopoverPrimitiveAttributes = {} as PopoverPrimitiveAttributes;
 * ```
 */
export type PopoverPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

/**
 * Event shape consumed by the Popover primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { PopoverTriggerEvent } from '@kovojs/headless-ui/popover';
 *
 * const value: PopoverTriggerEvent = {} as PopoverTriggerEvent;
 * ```
 */
export type PopoverTriggerEvent = Event;

/**
 * Event shape consumed by the Popover primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { PopoverEscapeEvent } from '@kovojs/headless-ui/popover';
 *
 * const value: PopoverEscapeEvent = {} as PopoverEscapeEvent;
 * ```
 */
export type PopoverEscapeEvent = Event & Readonly<{ key?: string }>;

/**
 * Event shape consumed by the Popover primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { PopoverBeforeToggleEvent } from '@kovojs/headless-ui/popover';
 *
 * const value: PopoverBeforeToggleEvent = {} as PopoverBeforeToggleEvent;
 * ```
 */
export type PopoverBeforeToggleEvent = Event &
  Readonly<{
    newState?: 'closed' | 'open';
  }>;

/**
 * Builds the popover root attributes record for the Popover primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { popoverRootAttributes } from '@kovojs/headless-ui/popover';
 *
 * const input = {} as Parameters<typeof popoverRootAttributes>[0];
 * const result = popoverRootAttributes(input);
 * ```
 */
export function popoverRootAttributes(state: PopoverState): PopoverPrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(openState(state.open), dataDisabled(state.disabled === true)),
  });
}

/**
 * Builds the popover trigger attributes record for the Popover primitive.
 *
 * Emits `aria-controls`, `aria-expanded`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { popoverTriggerAttributes } from '@kovojs/headless-ui/popover';
 *
 * const input = {} as Parameters<typeof popoverTriggerAttributes>[0];
 * const result = popoverTriggerAttributes(input);
 * ```
 */
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

/**
 * Builds the popover content attributes record for the Popover primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { popoverContentAttributes } from '@kovojs/headless-ui/popover';
 *
 * const input = {} as Parameters<typeof popoverContentAttributes>[0];
 * const result = popoverContentAttributes(input);
 * ```
 */
export function popoverContentAttributes(
  options: PopoverAttributeOptions,
): PopoverPrimitiveAttributes {
  return Object.freeze({
    ...openState(options.open),
    ...(options.contentId === undefined ? {} : { id: options.contentId }),
    popover: 'auto',
  });
}

/**
 * Computes the set popover open transition for the Popover primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setPopoverOpen } from '@kovojs/headless-ui/popover';
 *
 * const input = {} as Parameters<typeof setPopoverOpen>[0];
 * const state = {} as Parameters<typeof setPopoverOpen>[1];
 * const options = {} as Parameters<typeof setPopoverOpen>[2];
 * const detail = {} as Parameters<typeof setPopoverOpen>[3];
 * const result = setPopoverOpen(input, state, options, detail);
 * ```
 */
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

/**
 * Computes the toggle popover transition for the Popover primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { togglePopover } from '@kovojs/headless-ui/popover';
 *
 * const input = {} as Parameters<typeof togglePopover>[0];
 * const state = {} as Parameters<typeof togglePopover>[1];
 * const options = {} as Parameters<typeof togglePopover>[2];
 * const result = togglePopover(input, state, options);
 * ```
 */
export function togglePopover(
  state: PopoverState,
  reason: PopoverChangeReason,
  options: PopoverChangeOptions = {},
): PopoverChangeResult {
  return setPopoverOpen(state, !state.open, reason, options);
}

/**
 * Handles the popover trigger click interaction for the Popover primitive.
 *
 * @example
 * ```ts
 * import { popoverTriggerClick } from '@kovojs/headless-ui/popover';
 *
 * const input = {} as Parameters<typeof popoverTriggerClick>[0];
 * const state = {} as Parameters<typeof popoverTriggerClick>[1];
 * const options = {} as Parameters<typeof popoverTriggerClick>[2];
 * const result = popoverTriggerClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the popover before toggle interaction for the Popover primitive.
 *
 * @example
 * ```ts
 * import { popoverBeforeToggle } from '@kovojs/headless-ui/popover';
 *
 * const input = {} as Parameters<typeof popoverBeforeToggle>[0];
 * const state = {} as Parameters<typeof popoverBeforeToggle>[1];
 * const options = {} as Parameters<typeof popoverBeforeToggle>[2];
 * const result = popoverBeforeToggle(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the popover escape key down interaction for the Popover primitive.
 *
 * @example
 * ```ts
 * import { popoverEscapeKeyDown } from '@kovojs/headless-ui/popover';
 *
 * const input = {} as Parameters<typeof popoverEscapeKeyDown>[0];
 * const state = {} as Parameters<typeof popoverEscapeKeyDown>[1];
 * const options = {} as Parameters<typeof popoverEscapeKeyDown>[2];
 * const result = popoverEscapeKeyDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
