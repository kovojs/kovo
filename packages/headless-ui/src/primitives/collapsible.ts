import {
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  openState,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

/**
 * Reason token reported by the Collapsible primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CollapsibleChangeReason } from '@kovojs/headless-ui/collapsible';
 *
 * const value: CollapsibleChangeReason = {} as CollapsibleChangeReason;
 * ```
 */
export type CollapsibleChangeReason = 'programmatic' | 'trigger-click';

/**
 * Cancelable change detail emitted by the Collapsible primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CollapsibleChangeDetail } from '@kovojs/headless-ui/collapsible';
 *
 * const value: CollapsibleChangeDetail = {} as CollapsibleChangeDetail;
 * ```
 */
export type CollapsibleChangeDetail = PrimitiveChangeDetail<CollapsibleChangeReason, boolean>;

/**
 * State snapshot consumed by the Collapsible primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CollapsibleState } from '@kovojs/headless-ui/collapsible';
 *
 * const value: CollapsibleState = {} as CollapsibleState;
 * ```
 */
export interface CollapsibleState {
  disabled?: boolean;
  open: boolean;
}

/**
 * Options accepted by the Collapsible primitive collapsible attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CollapsibleAttributeOptions } from '@kovojs/headless-ui/collapsible';
 *
 * const value: CollapsibleAttributeOptions = {} as CollapsibleAttributeOptions;
 * ```
 */
export interface CollapsibleAttributeOptions extends CollapsibleState {
  contentId?: string;
}

/**
 * Options accepted by the Collapsible primitive collapsible change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CollapsibleChangeOptions } from '@kovojs/headless-ui/collapsible';
 *
 * const value: CollapsibleChangeOptions = {} as CollapsibleChangeOptions;
 * ```
 */
export interface CollapsibleChangeOptions {
  onOpenChange?: (detail: CollapsibleChangeDetail) => void;
}

/**
 * Result returned by the Collapsible primitive collapsible change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CollapsibleChangeResult } from '@kovojs/headless-ui/collapsible';
 *
 * const value: CollapsibleChangeResult = {} as CollapsibleChangeResult;
 * ```
 */
export interface CollapsibleChangeResult {
  changed: boolean;
  detail?: CollapsibleChangeDetail;
  open: boolean;
}

/**
 * Serializable attribute record returned by Collapsible primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CollapsiblePrimitiveAttributes } from '@kovojs/headless-ui/collapsible';
 *
 * const value: CollapsiblePrimitiveAttributes = {} as CollapsiblePrimitiveAttributes;
 * ```
 */
export type CollapsiblePrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

/**
 * Event shape consumed by the Collapsible primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CollapsibleTriggerEvent } from '@kovojs/headless-ui/collapsible';
 *
 * const value: CollapsibleTriggerEvent = {} as CollapsibleTriggerEvent;
 * ```
 */
export type CollapsibleTriggerEvent = Event;

/**
 * Builds the collapsible root attributes record for the Collapsible primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { collapsibleRootAttributes } from '@kovojs/headless-ui/collapsible';
 *
 * const input = {} as Parameters<typeof collapsibleRootAttributes>[0];
 * const result = collapsibleRootAttributes(input);
 * ```
 */
export function collapsibleRootAttributes(state: CollapsibleState): CollapsiblePrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(openState(state.open), dataDisabled(state.disabled === true)),
    open: state.open,
  });
}

/**
 * Builds the collapsible trigger attributes record for the Collapsible primitive.
 *
 * Emits `aria-controls`, `aria-expanded`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { collapsibleTriggerAttributes } from '@kovojs/headless-ui/collapsible';
 *
 * const input = {} as Parameters<typeof collapsibleTriggerAttributes>[0];
 * const result = collapsibleTriggerAttributes(input);
 * ```
 */
export function collapsibleTriggerAttributes(
  options: CollapsibleAttributeOptions,
): CollapsiblePrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(openState(options.open), dataDisabled(options.disabled === true)),
    'aria-expanded': String(options.open),
    ...(options.contentId === undefined ? {} : { 'aria-controls': options.contentId }),
  });
}

/**
 * Builds the collapsible content attributes record for the Collapsible primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { collapsibleContentAttributes } from '@kovojs/headless-ui/collapsible';
 *
 * const input = {} as Parameters<typeof collapsibleContentAttributes>[0];
 * const result = collapsibleContentAttributes(input);
 * ```
 */
export function collapsibleContentAttributes(
  options: CollapsibleAttributeOptions,
): CollapsiblePrimitiveAttributes {
  return Object.freeze({
    ...openState(options.open),
    ...(options.contentId === undefined ? {} : { id: options.contentId }),
  });
}

/**
 * Computes the set collapsible open transition for the Collapsible primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setCollapsibleOpen } from '@kovojs/headless-ui/collapsible';
 *
 * const input = {} as Parameters<typeof setCollapsibleOpen>[0];
 * const state = {} as Parameters<typeof setCollapsibleOpen>[1];
 * const options = {} as Parameters<typeof setCollapsibleOpen>[2];
 * const detail = {} as Parameters<typeof setCollapsibleOpen>[3];
 * const result = setCollapsibleOpen(input, state, options, detail);
 * ```
 */
export function setCollapsibleOpen(
  state: CollapsibleState,
  open: boolean,
  reason: CollapsibleChangeReason,
  options: CollapsibleChangeOptions = {},
): CollapsibleChangeResult {
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
 * Computes the toggle collapsible transition for the Collapsible primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleCollapsible } from '@kovojs/headless-ui/collapsible';
 *
 * const input = {} as Parameters<typeof toggleCollapsible>[0];
 * const state = {} as Parameters<typeof toggleCollapsible>[1];
 * const options = {} as Parameters<typeof toggleCollapsible>[2];
 * const result = toggleCollapsible(input, state, options);
 * ```
 */
export function toggleCollapsible(
  state: CollapsibleState,
  reason: CollapsibleChangeReason,
  options: CollapsibleChangeOptions = {},
): CollapsibleChangeResult {
  return setCollapsibleOpen(state, !state.open, reason, options);
}

/**
 * Handles the collapsible trigger click interaction for the Collapsible primitive.
 *
 * @example
 * ```ts
 * import { collapsibleTriggerClick } from '@kovojs/headless-ui/collapsible';
 *
 * const input = {} as Parameters<typeof collapsibleTriggerClick>[0];
 * const state = {} as Parameters<typeof collapsibleTriggerClick>[1];
 * const options = {} as Parameters<typeof collapsibleTriggerClick>[2];
 * const result = collapsibleTriggerClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function collapsibleTriggerClick(
  event: CollapsibleTriggerEvent,
  state: CollapsibleState,
  options: CollapsibleChangeOptions = {},
): CollapsibleChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = toggleCollapsible(state, 'trigger-click', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}
