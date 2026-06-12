import {
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  openState,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

export type CollapsibleChangeReason = 'programmatic' | 'trigger-click';

export type CollapsibleChangeDetail = PrimitiveChangeDetail<CollapsibleChangeReason, boolean>;

export interface CollapsibleState {
  disabled?: boolean;
  open: boolean;
}

export interface CollapsibleAttributeOptions extends CollapsibleState {
  contentId?: string;
}

export interface CollapsibleChangeOptions {
  onOpenChange?: (detail: CollapsibleChangeDetail) => void;
}

export interface CollapsibleChangeResult {
  changed: boolean;
  detail?: CollapsibleChangeDetail;
  open: boolean;
}

export type CollapsiblePrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

export type CollapsibleTriggerEvent = Event;

export function collapsibleRootAttributes(state: CollapsibleState): CollapsiblePrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(openState(state.open), dataDisabled(state.disabled === true)),
    open: state.open,
  });
}

export function collapsibleTriggerAttributes(
  options: CollapsibleAttributeOptions,
): CollapsiblePrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(openState(options.open), dataDisabled(options.disabled === true)),
    'aria-expanded': String(options.open),
    ...(options.contentId === undefined ? {} : { 'aria-controls': options.contentId }),
  });
}

export function collapsibleContentAttributes(
  options: CollapsibleAttributeOptions,
): CollapsiblePrimitiveAttributes {
  return Object.freeze({
    ...openState(options.open),
    ...(options.contentId === undefined ? {} : { id: options.contentId }),
  });
}

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

export function toggleCollapsible(
  state: CollapsibleState,
  reason: CollapsibleChangeReason,
  options: CollapsibleChangeOptions = {},
): CollapsibleChangeResult {
  return setCollapsibleOpen(state, !state.open, reason, options);
}

/**
 * @jisoPrimitiveHandler
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
