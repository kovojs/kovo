import {
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  openState,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';
import { runDialogInvokerCommand, type DialogInvokerEvent } from '../lib/dialog-invoker.js';

/**
 * Reason token reported by the Alert Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AlertDialogChangeReason } from '@kovojs/headless-ui/alert-dialog';
 *
 * const value: AlertDialogChangeReason = {} as AlertDialogChangeReason;
 * ```
 */
export type AlertDialogChangeReason =
  | 'action-click'
  | 'cancel-click'
  | 'cancel-event'
  | 'native-beforetoggle'
  | 'programmatic'
  | 'trigger-click';

/**
 * Cancelable change detail emitted by the Alert Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AlertDialogChangeDetail } from '@kovojs/headless-ui/alert-dialog';
 *
 * const value: AlertDialogChangeDetail = {} as AlertDialogChangeDetail;
 * ```
 */
export type AlertDialogChangeDetail = PrimitiveChangeDetail<AlertDialogChangeReason, boolean>;

/**
 * Public type used by the Alert Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AlertDialogActionIntent } from '@kovojs/headless-ui/alert-dialog';
 *
 * const value: AlertDialogActionIntent = {} as AlertDialogActionIntent;
 * ```
 */
export type AlertDialogActionIntent = 'confirm' | 'destructive';

/**
 * State snapshot consumed by the Alert Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AlertDialogState } from '@kovojs/headless-ui/alert-dialog';
 *
 * const value: AlertDialogState = {} as AlertDialogState;
 * ```
 */
export interface AlertDialogState {
  disabled?: boolean;
  open: boolean;
}

/**
 * Options accepted by the Alert Dialog primitive alert dialog attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AlertDialogAttributeOptions } from '@kovojs/headless-ui/alert-dialog';
 *
 * const value: AlertDialogAttributeOptions = {} as AlertDialogAttributeOptions;
 * ```
 */
export interface AlertDialogAttributeOptions extends AlertDialogState {
  contentId?: string;
  descriptionId?: string;
  titleId?: string;
}

/**
 * Options accepted by the Alert Dialog primitive alert dialog action attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AlertDialogActionAttributeOptions } from '@kovojs/headless-ui/alert-dialog';
 *
 * const value: AlertDialogActionAttributeOptions = {} as AlertDialogActionAttributeOptions;
 * ```
 */
export interface AlertDialogActionAttributeOptions extends AlertDialogAttributeOptions {
  intent?: AlertDialogActionIntent;
}

/**
 * Options accepted by the Alert Dialog primitive alert dialog cancel attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AlertDialogCancelAttributeOptions } from '@kovojs/headless-ui/alert-dialog';
 *
 * const value: AlertDialogCancelAttributeOptions = {} as AlertDialogCancelAttributeOptions;
 * ```
 */
export interface AlertDialogCancelAttributeOptions extends AlertDialogAttributeOptions {
  autoFocus?: boolean;
}

/**
 * Options accepted by the Alert Dialog primitive alert dialog change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AlertDialogChangeOptions } from '@kovojs/headless-ui/alert-dialog';
 *
 * const value: AlertDialogChangeOptions = {} as AlertDialogChangeOptions;
 * ```
 */
export interface AlertDialogChangeOptions {
  onOpenChange?: (detail: AlertDialogChangeDetail) => void;
}

/**
 * Result returned by the Alert Dialog primitive alert dialog change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AlertDialogChangeResult } from '@kovojs/headless-ui/alert-dialog';
 *
 * const value: AlertDialogChangeResult = {} as AlertDialogChangeResult;
 * ```
 */
export interface AlertDialogChangeResult {
  changed: boolean;
  detail?: AlertDialogChangeDetail;
  open: boolean;
}

/**
 * Serializable attribute record returned by Alert Dialog primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AlertDialogPrimitiveAttributes } from '@kovojs/headless-ui/alert-dialog';
 *
 * const value: AlertDialogPrimitiveAttributes = {} as AlertDialogPrimitiveAttributes;
 * ```
 */
export type AlertDialogPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

/**
 * Event shape consumed by the Alert Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AlertDialogTriggerEvent } from '@kovojs/headless-ui/alert-dialog';
 *
 * const value: AlertDialogTriggerEvent = {} as AlertDialogTriggerEvent;
 * ```
 */
export type AlertDialogTriggerEvent = Event & DialogInvokerEvent;

/**
 * Event shape consumed by the Alert Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AlertDialogActionEvent } from '@kovojs/headless-ui/alert-dialog';
 *
 * const value: AlertDialogActionEvent = {} as AlertDialogActionEvent;
 * ```
 */
export type AlertDialogActionEvent = Event & DialogInvokerEvent;

/**
 * Event shape consumed by the Alert Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AlertDialogCancelButtonEvent } from '@kovojs/headless-ui/alert-dialog';
 *
 * const value: AlertDialogCancelButtonEvent = {} as AlertDialogCancelButtonEvent;
 * ```
 */
export type AlertDialogCancelButtonEvent = Event & DialogInvokerEvent;

/**
 * Event shape consumed by the Alert Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AlertDialogCancelEvent } from '@kovojs/headless-ui/alert-dialog';
 *
 * const value: AlertDialogCancelEvent = {} as AlertDialogCancelEvent;
 * ```
 */
export type AlertDialogCancelEvent = Event;

/**
 * Event shape consumed by the Alert Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AlertDialogBeforeToggleEvent } from '@kovojs/headless-ui/alert-dialog';
 *
 * const value: AlertDialogBeforeToggleEvent = {} as AlertDialogBeforeToggleEvent;
 * ```
 */
export type AlertDialogBeforeToggleEvent = Event &
  Readonly<{
    newState?: 'closed' | 'open';
  }>;

/**
 * Builds the alert dialog root attributes record for the Alert Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { alertDialogRootAttributes } from '@kovojs/headless-ui/alert-dialog';
 *
 * const input = {} as Parameters<typeof alertDialogRootAttributes>[0];
 * const result = alertDialogRootAttributes(input);
 * ```
 */
export function alertDialogRootAttributes(state: AlertDialogState): AlertDialogPrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(openState(state.open), dataDisabled(state.disabled === true)),
  });
}

/**
 * Builds the alert dialog trigger attributes record for the Alert Dialog primitive.
 *
 * Emits `aria-controls`, `aria-expanded`, `aria-haspopup`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { alertDialogTriggerAttributes } from '@kovojs/headless-ui/alert-dialog';
 *
 * const input = {} as Parameters<typeof alertDialogTriggerAttributes>[0];
 * const result = alertDialogTriggerAttributes(input);
 * ```
 */
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

/**
 * Builds the alert dialog content attributes record for the Alert Dialog primitive.
 *
 * Emits `aria-describedby`, `aria-labelledby`, `aria-modal`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { alertDialogContentAttributes } from '@kovojs/headless-ui/alert-dialog';
 *
 * const input = {} as Parameters<typeof alertDialogContentAttributes>[0];
 * const result = alertDialogContentAttributes(input);
 * ```
 */
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

/**
 * Builds the alert dialog cancel attributes record for the Alert Dialog primitive.
 *
 * Emits `data-intent`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { alertDialogCancelAttributes } from '@kovojs/headless-ui/alert-dialog';
 *
 * const input = {} as Parameters<typeof alertDialogCancelAttributes>[0];
 * const result = alertDialogCancelAttributes(input);
 * ```
 */
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

/**
 * Builds the alert dialog action attributes record for the Alert Dialog primitive.
 *
 * Emits `data-intent`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { alertDialogActionAttributes } from '@kovojs/headless-ui/alert-dialog';
 *
 * const input = {} as Parameters<typeof alertDialogActionAttributes>[0];
 * const result = alertDialogActionAttributes(input);
 * ```
 */
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

/**
 * Computes the set alert dialog open transition for the Alert Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setAlertDialogOpen } from '@kovojs/headless-ui/alert-dialog';
 *
 * const input = {} as Parameters<typeof setAlertDialogOpen>[0];
 * const state = {} as Parameters<typeof setAlertDialogOpen>[1];
 * const options = {} as Parameters<typeof setAlertDialogOpen>[2];
 * const detail = {} as Parameters<typeof setAlertDialogOpen>[3];
 * const result = setAlertDialogOpen(input, state, options, detail);
 * ```
 */
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

/**
 * Computes the toggle alert dialog transition for the Alert Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleAlertDialog } from '@kovojs/headless-ui/alert-dialog';
 *
 * const input = {} as Parameters<typeof toggleAlertDialog>[0];
 * const state = {} as Parameters<typeof toggleAlertDialog>[1];
 * const options = {} as Parameters<typeof toggleAlertDialog>[2];
 * const result = toggleAlertDialog(input, state, options);
 * ```
 */
export function toggleAlertDialog(
  state: AlertDialogState,
  reason: AlertDialogChangeReason,
  options: AlertDialogChangeOptions = {},
): AlertDialogChangeResult {
  return setAlertDialogOpen(state, !state.open, reason, options);
}

/**
 * Handles the alert dialog trigger click interaction for the Alert Dialog primitive.
 *
 * @example
 * ```ts
 * import { alertDialogTriggerClick } from '@kovojs/headless-ui/alert-dialog';
 *
 * const input = {} as Parameters<typeof alertDialogTriggerClick>[0];
 * const state = {} as Parameters<typeof alertDialogTriggerClick>[1];
 * const options = {} as Parameters<typeof alertDialogTriggerClick>[2];
 * const result = alertDialogTriggerClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
  if (result.changed) runDialogInvokerCommand(event, 'show-modal');
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}

/**
 * Handles the alert dialog cancel click interaction for the Alert Dialog primitive.
 *
 * @example
 * ```ts
 * import { alertDialogCancelClick } from '@kovojs/headless-ui/alert-dialog';
 *
 * const input = {} as Parameters<typeof alertDialogCancelClick>[0];
 * const state = {} as Parameters<typeof alertDialogCancelClick>[1];
 * const options = {} as Parameters<typeof alertDialogCancelClick>[2];
 * const result = alertDialogCancelClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
  if (result.changed) runDialogInvokerCommand(event, 'request-close');
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}

/**
 * Handles the alert dialog action click interaction for the Alert Dialog primitive.
 *
 * @example
 * ```ts
 * import { alertDialogActionClick } from '@kovojs/headless-ui/alert-dialog';
 *
 * const input = {} as Parameters<typeof alertDialogActionClick>[0];
 * const state = {} as Parameters<typeof alertDialogActionClick>[1];
 * const options = {} as Parameters<typeof alertDialogActionClick>[2];
 * const result = alertDialogActionClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
  if (result.changed) runDialogInvokerCommand(event, 'request-close');
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}

/**
 * Handles the alert dialog cancel interaction for the Alert Dialog primitive.
 *
 * @example
 * ```ts
 * import { alertDialogCancel } from '@kovojs/headless-ui/alert-dialog';
 *
 * const input = {} as Parameters<typeof alertDialogCancel>[0];
 * const state = {} as Parameters<typeof alertDialogCancel>[1];
 * const options = {} as Parameters<typeof alertDialogCancel>[2];
 * const result = alertDialogCancel(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the alert dialog before toggle interaction for the Alert Dialog primitive.
 *
 * @example
 * ```ts
 * import { alertDialogBeforeToggle } from '@kovojs/headless-ui/alert-dialog';
 *
 * const input = {} as Parameters<typeof alertDialogBeforeToggle>[0];
 * const state = {} as Parameters<typeof alertDialogBeforeToggle>[1];
 * const options = {} as Parameters<typeof alertDialogBeforeToggle>[2];
 * const result = alertDialogBeforeToggle(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
