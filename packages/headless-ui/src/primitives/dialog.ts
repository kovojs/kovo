import {
  dataDisabled,
  mergeDataAttributes,
  openStateFromBeforeToggle,
  openState,
  setOpenState,
  toggleOpenState,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';
import { runDialogInvokerCommand, type DialogInvokerEvent } from '../lib/dialog-invoker.js';

/**
 * Reason token reported by the Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DialogChangeReason } from '@kovojs/headless-ui/dialog';
 *
 * declare const value: DialogChangeReason;
 * ```
 */
export type DialogChangeReason =
  | 'cancel-event'
  | 'close-click'
  | 'native-beforetoggle'
  | 'programmatic'
  | 'trigger-click';

/**
 * Cancelable change detail emitted by the Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DialogChangeDetail } from '@kovojs/headless-ui/dialog';
 *
 * declare const value: DialogChangeDetail;
 * ```
 */
export type DialogChangeDetail = PrimitiveChangeDetail<DialogChangeReason, boolean>;

/**
 * State snapshot consumed by the Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DialogState } from '@kovojs/headless-ui/dialog';
 *
 * declare const value: DialogState;
 * ```
 */
export interface DialogState {
  disabled?: boolean;
  open: boolean;
}

/**
 * Options accepted by the Dialog primitive dialog attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DialogAttributeOptions } from '@kovojs/headless-ui/dialog';
 *
 * declare const value: DialogAttributeOptions;
 * ```
 */
export interface DialogAttributeOptions extends DialogState {
  contentId?: string;
  descriptionId?: string;
  dismissible?: boolean;
  titleId?: string;
}

/**
 * Options accepted by the Dialog primitive dialog change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DialogChangeOptions } from '@kovojs/headless-ui/dialog';
 *
 * declare const value: DialogChangeOptions;
 * ```
 */
export interface DialogChangeOptions {
  onOpenChange?: (detail: DialogChangeDetail) => void;
}

/**
 * Result returned by the Dialog primitive dialog change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DialogChangeResult } from '@kovojs/headless-ui/dialog';
 *
 * declare const value: DialogChangeResult;
 * ```
 */
export interface DialogChangeResult {
  changed: boolean;
  detail?: DialogChangeDetail;
  open: boolean;
}

/**
 * Serializable attribute record returned by Dialog primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DialogPrimitiveAttributes } from '@kovojs/headless-ui/dialog';
 *
 * declare const value: DialogPrimitiveAttributes;
 * ```
 */
export type DialogPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

/**
 * Event shape consumed by the Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DialogTriggerEvent } from '@kovojs/headless-ui/dialog';
 *
 * declare const value: DialogTriggerEvent;
 * ```
 */
export type DialogTriggerEvent = Event & DialogInvokerEvent;

/**
 * Event shape consumed by the Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DialogCloseEvent } from '@kovojs/headless-ui/dialog';
 *
 * declare const value: DialogCloseEvent;
 * ```
 */
export type DialogCloseEvent = Event & DialogInvokerEvent;

/**
 * Event shape consumed by the Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DialogCancelEvent } from '@kovojs/headless-ui/dialog';
 *
 * declare const value: DialogCancelEvent;
 * ```
 */
export type DialogCancelEvent = Event;

/**
 * Event shape consumed by the Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DialogBeforeToggleEvent } from '@kovojs/headless-ui/dialog';
 *
 * declare const value: DialogBeforeToggleEvent;
 * ```
 */
export type DialogBeforeToggleEvent = Event &
  Readonly<{
    newState?: 'closed' | 'open';
  }>;

/**
 * Builds the dialog root attributes record for the Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { dialogRootAttributes } from '@kovojs/headless-ui/dialog';
 *
 * declare const input: Parameters<typeof dialogRootAttributes>[0];
 * const result = dialogRootAttributes(input);
 * ```
 */
export function dialogRootAttributes(state: DialogState): DialogPrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(openState(state.open), dataDisabled(state.disabled === true)),
  });
}

/**
 * Builds the dialog trigger attributes record for the Dialog primitive.
 *
 * Emits `aria-controls`, `aria-expanded`, `aria-haspopup`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { dialogTriggerAttributes } from '@kovojs/headless-ui/dialog';
 *
 * declare const input: Parameters<typeof dialogTriggerAttributes>[0];
 * const result = dialogTriggerAttributes(input);
 * ```
 */
export function dialogTriggerAttributes(
  options: DialogAttributeOptions,
): DialogPrimitiveAttributes {
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
 * Builds the dialog content attributes record for the Dialog primitive.
 *
 * Emits `aria-describedby`, `aria-labelledby`, `aria-modal`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { dialogContentAttributes } from '@kovojs/headless-ui/dialog';
 *
 * declare const input: Parameters<typeof dialogContentAttributes>[0];
 * const result = dialogContentAttributes(input);
 * ```
 */
export function dialogContentAttributes(
  options: DialogAttributeOptions,
): DialogPrimitiveAttributes {
  return Object.freeze({
    ...openState(options.open),
    // J5 (OFM-1, SPEC.md §4.6): mark the content as a modal dialog so AT treats
    // the background as inert, matching alert-dialog/command. Without this the
    // most-used overlay (cart drawer, modal forms) lets screen readers wander
    // the page behind the open modal.
    'aria-modal': 'true',
    closedby: options.dismissible === false ? 'closerequest' : 'any',
    open: options.open,
    role: 'dialog',
    ...(options.contentId === undefined ? {} : { id: options.contentId }),
    ...(options.titleId === undefined ? {} : { 'aria-labelledby': options.titleId }),
    ...(options.descriptionId === undefined ? {} : { 'aria-describedby': options.descriptionId }),
  });
}

/**
 * Builds the dialog close attributes record for the Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { dialogCloseAttributes } from '@kovojs/headless-ui/dialog';
 *
 * declare const input: Parameters<typeof dialogCloseAttributes>[0];
 * const result = dialogCloseAttributes(input);
 * ```
 */
export function dialogCloseAttributes(options: DialogAttributeOptions): DialogPrimitiveAttributes {
  const enabledContentId = options.disabled === true ? undefined : options.contentId;

  return Object.freeze({
    ...mergeDataAttributes(openState(options.open), dataDisabled(options.disabled === true)),
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
 * Computes the set dialog open transition for the Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setDialogOpen } from '@kovojs/headless-ui/dialog';
 *
 * declare const input: Parameters<typeof setDialogOpen>[0];
 * declare const state: Parameters<typeof setDialogOpen>[1];
 * declare const options: Parameters<typeof setDialogOpen>[2];
 * declare const detail: Parameters<typeof setDialogOpen>[3];
 * const result = setDialogOpen(input, state, options, detail);
 * ```
 *
 * @internal
 */
export function setDialogOpen(
  state: DialogState,
  open: boolean,
  reason: DialogChangeReason,
  options: DialogChangeOptions = {},
): DialogChangeResult {
  return setOpenState(state, open, reason, options);
}

/**
 * Computes the toggle dialog transition for the Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleDialog } from '@kovojs/headless-ui/dialog';
 *
 * declare const input: Parameters<typeof toggleDialog>[0];
 * declare const state: Parameters<typeof toggleDialog>[1];
 * declare const options: Parameters<typeof toggleDialog>[2];
 * const result = toggleDialog(input, state, options);
 * ```
 *
 * @internal
 */
export function toggleDialog(
  state: DialogState,
  reason: DialogChangeReason,
  options: DialogChangeOptions = {},
): DialogChangeResult {
  return toggleOpenState(state, reason, options);
}

/**
 * Handles the dialog trigger click interaction for the Dialog primitive.
 *
 * @example
 * ```ts
 * import { dialogTriggerClick } from '@kovojs/headless-ui/dialog';
 *
 * declare const input: Parameters<typeof dialogTriggerClick>[0];
 * declare const state: Parameters<typeof dialogTriggerClick>[1];
 * declare const options: Parameters<typeof dialogTriggerClick>[2];
 * const result = dialogTriggerClick(input, state, options);
 * ```
 *
 * @generated
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function dialogTriggerClick(
  event: DialogTriggerEvent,
  state: DialogState,
  options: DialogChangeOptions = {},
): DialogChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = setDialogOpen(state, true, 'trigger-click', options);
  if (result.changed) runDialogInvokerCommand(event, 'show-modal');
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}

/**
 * Handles the dialog close click interaction for the Dialog primitive.
 *
 * @example
 * ```ts
 * import { dialogCloseClick } from '@kovojs/headless-ui/dialog';
 *
 * declare const input: Parameters<typeof dialogCloseClick>[0];
 * declare const state: Parameters<typeof dialogCloseClick>[1];
 * declare const options: Parameters<typeof dialogCloseClick>[2];
 * const result = dialogCloseClick(input, state, options);
 * ```
 *
 * @generated
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function dialogCloseClick(
  event: DialogCloseEvent,
  state: DialogState,
  options: DialogChangeOptions = {},
): DialogChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = setDialogOpen(state, false, 'close-click', options);
  if (result.changed) runDialogInvokerCommand(event, 'request-close');
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}

/**
 * Handles the dialog cancel interaction for the Dialog primitive.
 *
 * @example
 * ```ts
 * import { dialogCancel } from '@kovojs/headless-ui/dialog';
 *
 * declare const input: Parameters<typeof dialogCancel>[0];
 * declare const state: Parameters<typeof dialogCancel>[1];
 * declare const options: Parameters<typeof dialogCancel>[2];
 * const result = dialogCancel(input, state, options);
 * ```
 *
 * @generated
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function dialogCancel(
  event: DialogCancelEvent,
  state: DialogState,
  options: DialogChangeOptions = {},
): DialogChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = setDialogOpen(state, false, 'cancel-event', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}

/**
 * Handles the dialog before toggle interaction for the Dialog primitive.
 *
 * @example
 * ```ts
 * import { dialogBeforeToggle } from '@kovojs/headless-ui/dialog';
 *
 * declare const input: Parameters<typeof dialogBeforeToggle>[0];
 * declare const state: Parameters<typeof dialogBeforeToggle>[1];
 * declare const options: Parameters<typeof dialogBeforeToggle>[2];
 * const result = dialogBeforeToggle(input, state, options);
 * ```
 *
 * @generated
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function dialogBeforeToggle(
  event: DialogBeforeToggleEvent,
  state: DialogState,
  options: DialogChangeOptions = {},
): DialogChangeResult | undefined {
  if (event.defaultPrevented) return;
  const open = openStateFromBeforeToggle(event);
  if (open === undefined) return;

  const result = setDialogOpen(state, open, 'native-beforetoggle', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}
