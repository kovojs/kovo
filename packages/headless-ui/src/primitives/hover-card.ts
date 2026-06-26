import {
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  openState,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

/**
 * Reason token reported by the Hover Card primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { HoverCardChangeReason } from '@kovojs/headless-ui/hover-card';
 *
 * const value: HoverCardChangeReason = {} as HoverCardChangeReason;
 * ```
 */
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

/**
 * Cancelable change detail emitted by the Hover Card primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { HoverCardChangeDetail } from '@kovojs/headless-ui/hover-card';
 *
 * const value: HoverCardChangeDetail = {} as HoverCardChangeDetail;
 * ```
 */
export type HoverCardChangeDetail = PrimitiveChangeDetail<HoverCardChangeReason, boolean>;

/**
 * State snapshot consumed by the Hover Card primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { HoverCardState } from '@kovojs/headless-ui/hover-card';
 *
 * const value: HoverCardState = {} as HoverCardState;
 * ```
 */
export interface HoverCardState {
  disabled?: boolean;
  open: boolean;
}

/**
 * Options accepted by the Hover Card primitive hover card attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { HoverCardAttributeOptions } from '@kovojs/headless-ui/hover-card';
 *
 * const value: HoverCardAttributeOptions = {} as HoverCardAttributeOptions;
 * ```
 */
export interface HoverCardAttributeOptions extends HoverCardState {
  contentId?: string;
}

/**
 * Options accepted by the Hover Card primitive hover card change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { HoverCardChangeOptions } from '@kovojs/headless-ui/hover-card';
 *
 * const value: HoverCardChangeOptions = {} as HoverCardChangeOptions;
 * ```
 */
export interface HoverCardChangeOptions {
  onOpenChange?: (detail: HoverCardChangeDetail) => void;
}

/**
 * Result returned by the Hover Card primitive hover card change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { HoverCardChangeResult } from '@kovojs/headless-ui/hover-card';
 *
 * const value: HoverCardChangeResult = {} as HoverCardChangeResult;
 * ```
 */
export interface HoverCardChangeResult {
  changed: boolean;
  detail?: HoverCardChangeDetail;
  open: boolean;
}

/**
 * Serializable attribute record returned by Hover Card primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { HoverCardPrimitiveAttributes } from '@kovojs/headless-ui/hover-card';
 *
 * const value: HoverCardPrimitiveAttributes = {} as HoverCardPrimitiveAttributes;
 * ```
 */
export type HoverCardPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

/**
 * Event shape consumed by the Hover Card primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { HoverCardTriggerEvent } from '@kovojs/headless-ui/hover-card';
 *
 * const value: HoverCardTriggerEvent = {} as HoverCardTriggerEvent;
 * ```
 */
export type HoverCardTriggerEvent = Event;

/**
 * Event shape consumed by the Hover Card primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { HoverCardContentEvent } from '@kovojs/headless-ui/hover-card';
 *
 * const value: HoverCardContentEvent = {} as HoverCardContentEvent;
 * ```
 */
export type HoverCardContentEvent = Event;

/**
 * Event shape consumed by the Hover Card primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { HoverCardEscapeEvent } from '@kovojs/headless-ui/hover-card';
 *
 * const value: HoverCardEscapeEvent = {} as HoverCardEscapeEvent;
 * ```
 */
export type HoverCardEscapeEvent = Event & Readonly<{ key?: string }>;

/**
 * Builds the hover card root attributes record for the Hover Card primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { hoverCardRootAttributes } from '@kovojs/headless-ui/hover-card';
 *
 * const input = {} as Parameters<typeof hoverCardRootAttributes>[0];
 * const result = hoverCardRootAttributes(input);
 * ```
 */
export function hoverCardRootAttributes(state: HoverCardState): HoverCardPrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(openState(state.open), dataDisabled(state.disabled === true)),
  });
}

/**
 * Builds the hover card trigger attributes record for the Hover Card primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { hoverCardTriggerAttributes } from '@kovojs/headless-ui/hover-card';
 *
 * const input = {} as Parameters<typeof hoverCardTriggerAttributes>[0];
 * const result = hoverCardTriggerAttributes(input);
 * ```
 */
export function hoverCardTriggerAttributes(
  options: HoverCardAttributeOptions,
): HoverCardPrimitiveAttributes {
  const enabledContentId = options.disabled === true ? undefined : options.contentId;

  return Object.freeze({
    ...mergeDataAttributes(openState(options.open), dataDisabled(options.disabled === true)),
    ...(enabledContentId === undefined
      ? {}
      : {
          'kovo-hover-card': enabledContentId,
        }),
  });
}

/**
 * Builds the hover card content attributes record for the Hover Card primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { hoverCardContentAttributes } from '@kovojs/headless-ui/hover-card';
 *
 * const input = {} as Parameters<typeof hoverCardContentAttributes>[0];
 * const result = hoverCardContentAttributes(input);
 * ```
 */
export function hoverCardContentAttributes(
  options: HoverCardAttributeOptions,
): HoverCardPrimitiveAttributes {
  return Object.freeze({
    ...openState(options.open),
    hidden: !options.open,
    ...(options.contentId === undefined ? {} : { id: options.contentId }),
    // No `popover` attribute: a manual popover stays `display:none` until an
    // imperative showPopover() call, which the gallery/demo path never makes, so
    // the card never appeared. Visibility is governed instead by the reactive
    // `hidden` + `[data-state=closed]{display:none}` the call site already drives.
  });
}

/**
 * Computes the set hover card open transition for the Hover Card primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setHoverCardOpen } from '@kovojs/headless-ui/hover-card';
 *
 * const input = {} as Parameters<typeof setHoverCardOpen>[0];
 * const state = {} as Parameters<typeof setHoverCardOpen>[1];
 * const options = {} as Parameters<typeof setHoverCardOpen>[2];
 * const detail = {} as Parameters<typeof setHoverCardOpen>[3];
 * const result = setHoverCardOpen(input, state, options, detail);
 * ```
 */
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
 * Handles the hover card trigger pointer enter interaction for the Hover Card primitive.
 *
 * @example
 * ```ts
 * import { hoverCardTriggerPointerEnter } from '@kovojs/headless-ui/hover-card';
 *
 * const input = {} as Parameters<typeof hoverCardTriggerPointerEnter>[0];
 * const state = {} as Parameters<typeof hoverCardTriggerPointerEnter>[1];
 * const options = {} as Parameters<typeof hoverCardTriggerPointerEnter>[2];
 * const result = hoverCardTriggerPointerEnter(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the hover card trigger pointer leave interaction for the Hover Card primitive.
 *
 * @example
 * ```ts
 * import { hoverCardTriggerPointerLeave } from '@kovojs/headless-ui/hover-card';
 *
 * const input = {} as Parameters<typeof hoverCardTriggerPointerLeave>[0];
 * const state = {} as Parameters<typeof hoverCardTriggerPointerLeave>[1];
 * const options = {} as Parameters<typeof hoverCardTriggerPointerLeave>[2];
 * const result = hoverCardTriggerPointerLeave(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the hover card trigger focus interaction for the Hover Card primitive.
 *
 * @example
 * ```ts
 * import { hoverCardTriggerFocus } from '@kovojs/headless-ui/hover-card';
 *
 * const input = {} as Parameters<typeof hoverCardTriggerFocus>[0];
 * const state = {} as Parameters<typeof hoverCardTriggerFocus>[1];
 * const options = {} as Parameters<typeof hoverCardTriggerFocus>[2];
 * const result = hoverCardTriggerFocus(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the hover card trigger blur interaction for the Hover Card primitive.
 *
 * @example
 * ```ts
 * import { hoverCardTriggerBlur } from '@kovojs/headless-ui/hover-card';
 *
 * const input = {} as Parameters<typeof hoverCardTriggerBlur>[0];
 * const state = {} as Parameters<typeof hoverCardTriggerBlur>[1];
 * const options = {} as Parameters<typeof hoverCardTriggerBlur>[2];
 * const result = hoverCardTriggerBlur(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the hover card content pointer enter interaction for the Hover Card primitive.
 *
 * @example
 * ```ts
 * import { hoverCardContentPointerEnter } from '@kovojs/headless-ui/hover-card';
 *
 * const input = {} as Parameters<typeof hoverCardContentPointerEnter>[0];
 * const state = {} as Parameters<typeof hoverCardContentPointerEnter>[1];
 * const options = {} as Parameters<typeof hoverCardContentPointerEnter>[2];
 * const result = hoverCardContentPointerEnter(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the hover card content pointer leave interaction for the Hover Card primitive.
 *
 * @example
 * ```ts
 * import { hoverCardContentPointerLeave } from '@kovojs/headless-ui/hover-card';
 *
 * const input = {} as Parameters<typeof hoverCardContentPointerLeave>[0];
 * const state = {} as Parameters<typeof hoverCardContentPointerLeave>[1];
 * const options = {} as Parameters<typeof hoverCardContentPointerLeave>[2];
 * const result = hoverCardContentPointerLeave(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the hover card content focus interaction for the Hover Card primitive.
 *
 * @example
 * ```ts
 * import { hoverCardContentFocus } from '@kovojs/headless-ui/hover-card';
 *
 * const input = {} as Parameters<typeof hoverCardContentFocus>[0];
 * const state = {} as Parameters<typeof hoverCardContentFocus>[1];
 * const options = {} as Parameters<typeof hoverCardContentFocus>[2];
 * const result = hoverCardContentFocus(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the hover card content blur interaction for the Hover Card primitive.
 *
 * @example
 * ```ts
 * import { hoverCardContentBlur } from '@kovojs/headless-ui/hover-card';
 *
 * const input = {} as Parameters<typeof hoverCardContentBlur>[0];
 * const state = {} as Parameters<typeof hoverCardContentBlur>[1];
 * const options = {} as Parameters<typeof hoverCardContentBlur>[2];
 * const result = hoverCardContentBlur(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the hover card escape key down interaction for the Hover Card primitive.
 *
 * @example
 * ```ts
 * import { hoverCardEscapeKeyDown } from '@kovojs/headless-ui/hover-card';
 *
 * const input = {} as Parameters<typeof hoverCardEscapeKeyDown>[0];
 * const state = {} as Parameters<typeof hoverCardEscapeKeyDown>[1];
 * const options = {} as Parameters<typeof hoverCardEscapeKeyDown>[2];
 * const result = hoverCardEscapeKeyDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
