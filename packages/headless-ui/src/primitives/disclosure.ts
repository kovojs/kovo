import {
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  openState,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

export type DisclosureChangeReason = 'programmatic' | 'trigger-click';

export type DisclosureChangeDetail = PrimitiveChangeDetail<DisclosureChangeReason, boolean>;

export interface DisclosureState {
  disabled?: boolean;
  open: boolean;
}

export interface DisclosureAttributeOptions extends DisclosureState {
  contentId?: string;
}

export interface DisclosureChangeOptions {
  onOpenChange?: (detail: DisclosureChangeDetail) => void;
}

export interface DisclosureChangeResult {
  changed: boolean;
  detail?: DisclosureChangeDetail;
  open: boolean;
}

export type DisclosurePrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

export type DisclosureTriggerEvent = Event;

export function disclosureRootAttributes(state: DisclosureState): DisclosurePrimitiveAttributes {
  return mergeDataAttributes(openState(state.open), dataDisabled(state.disabled === true));
}

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

export function disclosureContentAttributes(
  options: DisclosureAttributeOptions,
): DisclosurePrimitiveAttributes {
  return Object.freeze({
    ...openState(options.open),
    hidden: !options.open,
    ...(options.contentId === undefined ? {} : { id: options.contentId }),
  });
}

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

export function toggleDisclosure(
  state: DisclosureState,
  reason: DisclosureChangeReason,
  options: DisclosureChangeOptions = {},
): DisclosureChangeResult {
  return setDisclosureOpen(state, !state.open, reason, options);
}

/**
 * @jisoPrimitiveHandler
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
