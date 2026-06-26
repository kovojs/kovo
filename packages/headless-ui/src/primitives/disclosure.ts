import {
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  openState,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

/**
 * Reason token reported by the Disclosure primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DisclosureChangeReason } from '@kovojs/headless-ui/disclosure';
 *
 * const value: DisclosureChangeReason = {} as DisclosureChangeReason;
 * ```
 */
export type DisclosureChangeReason = 'programmatic' | 'trigger-click';

/**
 * Cancelable change detail emitted by the Disclosure primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DisclosureChangeDetail } from '@kovojs/headless-ui/disclosure';
 *
 * const value: DisclosureChangeDetail = {} as DisclosureChangeDetail;
 * ```
 */
export type DisclosureChangeDetail = PrimitiveChangeDetail<DisclosureChangeReason, boolean>;

/**
 * State snapshot consumed by the Disclosure primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DisclosureState } from '@kovojs/headless-ui/disclosure';
 *
 * const value: DisclosureState = {} as DisclosureState;
 * ```
 */
export interface DisclosureState {
  disabled?: boolean;
  open: boolean;
}

/**
 * Options accepted by the Disclosure primitive disclosure attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DisclosureAttributeOptions } from '@kovojs/headless-ui/disclosure';
 *
 * const value: DisclosureAttributeOptions = {} as DisclosureAttributeOptions;
 * ```
 */
export interface DisclosureAttributeOptions extends DisclosureState {
  contentId?: string;
}

/**
 * Options accepted by the Disclosure primitive disclosure change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DisclosureChangeOptions } from '@kovojs/headless-ui/disclosure';
 *
 * const value: DisclosureChangeOptions = {} as DisclosureChangeOptions;
 * ```
 */
export interface DisclosureChangeOptions {
  onOpenChange?: (detail: DisclosureChangeDetail) => void;
}

/**
 * Result returned by the Disclosure primitive disclosure change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DisclosureChangeResult } from '@kovojs/headless-ui/disclosure';
 *
 * const value: DisclosureChangeResult = {} as DisclosureChangeResult;
 * ```
 */
export interface DisclosureChangeResult {
  changed: boolean;
  detail?: DisclosureChangeDetail;
  open: boolean;
}

/**
 * Serializable attribute record returned by Disclosure primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DisclosurePrimitiveAttributes } from '@kovojs/headless-ui/disclosure';
 *
 * const value: DisclosurePrimitiveAttributes = {} as DisclosurePrimitiveAttributes;
 * ```
 */
export type DisclosurePrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

/**
 * Event shape consumed by the Disclosure primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DisclosureTriggerEvent } from '@kovojs/headless-ui/disclosure';
 *
 * const value: DisclosureTriggerEvent = {} as DisclosureTriggerEvent;
 * ```
 */
export type DisclosureTriggerEvent = Event;

/**
 * Builds the disclosure root attributes record for the Disclosure primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { disclosureRootAttributes } from '@kovojs/headless-ui/disclosure';
 *
 * const input = {} as Parameters<typeof disclosureRootAttributes>[0];
 * const result = disclosureRootAttributes(input);
 * ```
 */
export function disclosureRootAttributes(state: DisclosureState): DisclosurePrimitiveAttributes {
  return mergeDataAttributes(openState(state.open), dataDisabled(state.disabled === true));
}

/**
 * Builds the disclosure trigger attributes record for the Disclosure primitive.
 *
 * Emits `aria-controls`, `aria-expanded`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { disclosureTriggerAttributes } from '@kovojs/headless-ui/disclosure';
 *
 * const input = {} as Parameters<typeof disclosureTriggerAttributes>[0];
 * const result = disclosureTriggerAttributes(input);
 * ```
 */
export function disclosureTriggerAttributes(
  options: DisclosureAttributeOptions,
): DisclosurePrimitiveAttributes {
  return Object.freeze({
    ...disclosureRootAttributes(options),
    'aria-expanded': String(options.open),
    disabled: options.disabled === true,
    type: 'button',
    ...(options.contentId === undefined ? {} : { 'aria-controls': options.contentId }),
  });
}

/**
 * Builds the disclosure content attributes record for the Disclosure primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { disclosureContentAttributes } from '@kovojs/headless-ui/disclosure';
 *
 * const input = {} as Parameters<typeof disclosureContentAttributes>[0];
 * const result = disclosureContentAttributes(input);
 * ```
 */
export function disclosureContentAttributes(
  options: DisclosureAttributeOptions,
): DisclosurePrimitiveAttributes {
  return Object.freeze({
    ...openState(options.open),
    hidden: !options.open,
    ...(options.contentId === undefined ? {} : { id: options.contentId }),
  });
}

/**
 * Computes the set disclosure open transition for the Disclosure primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setDisclosureOpen } from '@kovojs/headless-ui/disclosure';
 *
 * const input = {} as Parameters<typeof setDisclosureOpen>[0];
 * const state = {} as Parameters<typeof setDisclosureOpen>[1];
 * const options = {} as Parameters<typeof setDisclosureOpen>[2];
 * const detail = {} as Parameters<typeof setDisclosureOpen>[3];
 * const result = setDisclosureOpen(input, state, options, detail);
 * ```
 */
export function setDisclosureOpen(
  state: DisclosureState,
  open: boolean,
  reason: DisclosureChangeReason,
  options: DisclosureChangeOptions = {},
): DisclosureChangeResult {
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
 * Computes the toggle disclosure transition for the Disclosure primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleDisclosure } from '@kovojs/headless-ui/disclosure';
 *
 * const input = {} as Parameters<typeof toggleDisclosure>[0];
 * const state = {} as Parameters<typeof toggleDisclosure>[1];
 * const options = {} as Parameters<typeof toggleDisclosure>[2];
 * const result = toggleDisclosure(input, state, options);
 * ```
 */
export function toggleDisclosure(
  state: DisclosureState,
  reason: DisclosureChangeReason,
  options: DisclosureChangeOptions = {},
): DisclosureChangeResult {
  return setDisclosureOpen(state, !state.open, reason, options);
}

/**
 * Handles the disclosure trigger click interaction for the Disclosure primitive.
 *
 * @example
 * ```ts
 * import { disclosureTriggerClick } from '@kovojs/headless-ui/disclosure';
 *
 * const input = {} as Parameters<typeof disclosureTriggerClick>[0];
 * const state = {} as Parameters<typeof disclosureTriggerClick>[1];
 * const options = {} as Parameters<typeof disclosureTriggerClick>[2];
 * const result = disclosureTriggerClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function disclosureTriggerClick(
  event: DisclosureTriggerEvent,
  state: DisclosureState,
  options: DisclosureChangeOptions = {},
): DisclosureChangeResult | undefined {
  if (event.defaultPrevented) return;

  return toggleDisclosure(state, 'trigger-click', options);
}
