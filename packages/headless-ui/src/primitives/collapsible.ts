import {
  dataDisabled,
  mergeDataAttributes,
  openState,
  setOpenState,
  toggleOpenState,
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
 * declare const value: CollapsibleChangeReason;
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
 * declare const value: CollapsibleChangeDetail;
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
 * declare const value: CollapsibleState;
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
 * declare const value: CollapsibleAttributeOptions;
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
 * declare const value: CollapsibleChangeOptions;
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
 * declare const value: CollapsibleChangeResult;
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
 * declare const value: CollapsiblePrimitiveAttributes;
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
 * declare const value: CollapsibleTriggerEvent;
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
 * declare const input: Parameters<typeof collapsibleRootAttributes>[0];
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
 * declare const input: Parameters<typeof collapsibleTriggerAttributes>[0];
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
 * declare const input: Parameters<typeof collapsibleContentAttributes>[0];
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
 * declare const input: Parameters<typeof setCollapsibleOpen>[0];
 * declare const state: Parameters<typeof setCollapsibleOpen>[1];
 * declare const options: Parameters<typeof setCollapsibleOpen>[2];
 * declare const detail: Parameters<typeof setCollapsibleOpen>[3];
 * const result = setCollapsibleOpen(input, state, options, detail);
 * ```
 *
 * @internal
 */
export function setCollapsibleOpen(
  state: CollapsibleState,
  open: boolean,
  reason: CollapsibleChangeReason,
  options: CollapsibleChangeOptions = {},
): CollapsibleChangeResult {
  return setOpenState(state, open, reason, options);
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
 * declare const input: Parameters<typeof toggleCollapsible>[0];
 * declare const state: Parameters<typeof toggleCollapsible>[1];
 * declare const options: Parameters<typeof toggleCollapsible>[2];
 * const result = toggleCollapsible(input, state, options);
 * ```
 *
 * @internal
 */
export function toggleCollapsible(
  state: CollapsibleState,
  reason: CollapsibleChangeReason,
  options: CollapsibleChangeOptions = {},
): CollapsibleChangeResult {
  return toggleOpenState(state, reason, options);
}

/**
 * Handles the collapsible trigger click interaction for the Collapsible primitive.
 *
 * @example
 * ```ts
 * import { collapsibleTriggerClick } from '@kovojs/headless-ui/collapsible';
 *
 * declare const input: Parameters<typeof collapsibleTriggerClick>[0];
 * declare const state: Parameters<typeof collapsibleTriggerClick>[1];
 * declare const options: Parameters<typeof collapsibleTriggerClick>[2];
 * const result = collapsibleTriggerClick(input, state, options);
 * ```
 *
 * @generated
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
