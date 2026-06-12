import {
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  openState,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

export type AlertDialogChangeReason =
  | 'action-click'
  | 'cancel-click'
  | 'cancel-event'
  | 'native-beforetoggle'
  | 'programmatic'
  | 'trigger-click';

export type AlertDialogChangeDetail = PrimitiveChangeDetail<AlertDialogChangeReason, boolean>;

export type AlertDialogActionIntent = 'confirm' | 'destructive';

export interface AlertDialogState {
  disabled?: boolean;
  open: boolean;
}

export interface AlertDialogAttributeOptions extends AlertDialogState {
  contentId?: string;
  descriptionId?: string;
  titleId?: string;
}

export interface AlertDialogActionAttributeOptions extends AlertDialogAttributeOptions {
  intent?: AlertDialogActionIntent;
}

export interface AlertDialogCancelAttributeOptions extends AlertDialogAttributeOptions {
  autoFocus?: boolean;
}

export interface AlertDialogChangeOptions {
  onOpenChange?: (detail: AlertDialogChangeDetail) => void;
}

export interface AlertDialogChangeResult {
  changed: boolean;
  detail?: AlertDialogChangeDetail;
  open: boolean;
}

export type AlertDialogPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

export type AlertDialogTriggerEvent = Event;

export type AlertDialogActionEvent = Event;

export type AlertDialogCancelButtonEvent = Event;

export type AlertDialogCancelEvent = Event;

export type AlertDialogBeforeToggleEvent = Event &
  Readonly<{
    newState?: 'closed' | 'open';
  }>;

export function alertDialogRootAttributes(state: AlertDialogState): AlertDialogPrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(openState(state.open), dataDisabled(state.disabled === true)),
  });
}

export function alertDialogTriggerAttributes(
  options: AlertDialogAttributeOptions,
): AlertDialogPrimitiveAttributes {
  const enabledContentId = options.disabled === true ? undefined : options.contentId;

  return Object.freeze({
    ...mergeDataAttributes(openState(options.open), dataDisabled(options.disabled === true)),
    'aria-expanded': String(options.open),
    'aria-haspopup': 'dialog',
    disabled: options.disabled === true,
    type: 'button',
    ...(enabledContentId === undefined
      ? {}
      : {
          'aria-controls': enabledContentId,
          command: 'show-modal',
          commandfor: enabledContentId,
        }),
  });
}

export function alertDialogContentAttributes(
  options: AlertDialogAttributeOptions,
): AlertDialogPrimitiveAttributes {
  return Object.freeze({
    ...openState(options.open),
    'aria-modal': 'true',
    open: options.open,
    role: 'alertdialog',
    ...(options.contentId === undefined ? {} : { id: options.contentId }),
    ...(options.titleId === undefined ? {} : { 'aria-labelledby': options.titleId }),
    ...(options.descriptionId === undefined ? {} : { 'aria-describedby': options.descriptionId }),
  });
}

export function alertDialogCancelAttributes(
  options: AlertDialogCancelAttributeOptions,
): AlertDialogPrimitiveAttributes {
  const enabledContentId = options.disabled === true ? undefined : options.contentId;

  return Object.freeze({
    ...mergeDataAttributes(openState(options.open), dataDisabled(options.disabled === true)),
    autofocus: options.autoFocus === true,
    'data-intent': 'cancel',
    disabled: options.disabled === true,
    type: 'button',
    ...(enabledContentId === undefined
      ? {}
      : {
          command: 'request-close',
          commandfor: enabledContentId,
        }),
  });
}

export function alertDialogActionAttributes(
  options: AlertDialogActionAttributeOptions,
): AlertDialogPrimitiveAttributes {
  const enabledContentId = options.disabled === true ? undefined : options.contentId;

  return Object.freeze({
    ...mergeDataAttributes(openState(options.open), dataDisabled(options.disabled === true)),
    'data-intent': options.intent ?? 'confirm',
    disabled: options.disabled === true,
    type: 'button',
    ...(enabledContentId === undefined
      ? {}
      : {
          command: 'request-close',
          commandfor: enabledContentId,
        }),
  });
}

export function setAlertDialogOpen(
  state: AlertDialogState,
  open: boolean,
  reason: AlertDialogChangeReason,
  options: AlertDialogChangeOptions = {},
): AlertDialogChangeResult {
  if (state.disabled || state.open === open) {
    return { changed: false, open: state.open };
  }

  const detail = dispatchCancelableChange({ reason, value: open }, options.onOpenChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, open: state.open };
  }

  return { changed: true, detail, open };
}

export function toggleAlertDialog(
  state: AlertDialogState,
  reason: AlertDialogChangeReason,
  options: AlertDialogChangeOptions = {},
): AlertDialogChangeResult {
  return setAlertDialogOpen(state, !state.open, reason, options);
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function alertDialogTriggerClick(
  event: AlertDialogTriggerEvent,
  state: AlertDialogState,
  options: AlertDialogChangeOptions = {},
): AlertDialogChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = setAlertDialogOpen(state, true, 'trigger-click', options);
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
export function alertDialogCancelClick(
  event: AlertDialogCancelButtonEvent,
  state: AlertDialogState,
  options: AlertDialogChangeOptions = {},
): AlertDialogChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = setAlertDialogOpen(state, false, 'cancel-click', options);
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
export function alertDialogActionClick(
  event: AlertDialogActionEvent,
  state: AlertDialogState,
  options: AlertDialogChangeOptions = {},
): AlertDialogChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = setAlertDialogOpen(state, false, 'action-click', options);
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
export function alertDialogCancel(
  event: AlertDialogCancelEvent,
  state: AlertDialogState,
  options: AlertDialogChangeOptions = {},
): AlertDialogChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = setAlertDialogOpen(state, false, 'cancel-event', options);
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
export function alertDialogBeforeToggle(
  event: AlertDialogBeforeToggleEvent,
  state: AlertDialogState,
  options: AlertDialogChangeOptions = {},
): AlertDialogChangeResult | undefined {
  if (event.defaultPrevented) return;
  if (event.newState !== 'open' && event.newState !== 'closed') return;

  const result = setAlertDialogOpen(
    state,
    event.newState === 'open',
    'native-beforetoggle',
    options,
  );
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}
