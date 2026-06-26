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
 * Reason token reported by the Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DialogChangeReason } from '@kovojs/headless-ui/dialog';
 *
 * const value: DialogChangeReason = {} as DialogChangeReason;
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
 * const value: DialogChangeDetail = {} as DialogChangeDetail;
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
 * const value: DialogState = {} as DialogState;
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
 * const value: DialogAttributeOptions = {} as DialogAttributeOptions;
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
 * const value: DialogChangeOptions = {} as DialogChangeOptions;
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
 * const value: DialogChangeResult = {} as DialogChangeResult;
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
 * const value: DialogPrimitiveAttributes = {} as DialogPrimitiveAttributes;
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
 * const value: DialogTriggerEvent = {} as DialogTriggerEvent;
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
 * const value: DialogCloseEvent = {} as DialogCloseEvent;
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
 * const value: DialogCancelEvent = {} as DialogCancelEvent;
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
 * const value: DialogBeforeToggleEvent = {} as DialogBeforeToggleEvent;
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
 * const input = {} as Parameters<typeof dialogRootAttributes>[0];
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
 * const input = {} as Parameters<typeof dialogTriggerAttributes>[0];
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
 * const input = {} as Parameters<typeof dialogContentAttributes>[0];
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
 * const input = {} as Parameters<typeof dialogCloseAttributes>[0];
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
 * const input = {} as Parameters<typeof setDialogOpen>[0];
 * const state = {} as Parameters<typeof setDialogOpen>[1];
 * const options = {} as Parameters<typeof setDialogOpen>[2];
 * const detail = {} as Parameters<typeof setDialogOpen>[3];
 * const result = setDialogOpen(input, state, options, detail);
 * ```
 */
export function setDialogOpen(
  state: DialogState,
  open: boolean,
  reason: DialogChangeReason,
  options: DialogChangeOptions = {},
): DialogChangeResult {
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
 * Computes the toggle dialog transition for the Dialog primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleDialog } from '@kovojs/headless-ui/dialog';
 *
 * const input = {} as Parameters<typeof toggleDialog>[0];
 * const state = {} as Parameters<typeof toggleDialog>[1];
 * const options = {} as Parameters<typeof toggleDialog>[2];
 * const result = toggleDialog(input, state, options);
 * ```
 */
export function toggleDialog(
  state: DialogState,
  reason: DialogChangeReason,
  options: DialogChangeOptions = {},
): DialogChangeResult {
  return setDialogOpen(state, !state.open, reason, options);
}

/**
 * Handles the dialog trigger click interaction for the Dialog primitive.
 *
 * @example
 * ```ts
 * import { dialogTriggerClick } from '@kovojs/headless-ui/dialog';
 *
 * const input = {} as Parameters<typeof dialogTriggerClick>[0];
 * const state = {} as Parameters<typeof dialogTriggerClick>[1];
 * const options = {} as Parameters<typeof dialogTriggerClick>[2];
 * const result = dialogTriggerClick(input, state, options);
 * ```
 *
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
 * const input = {} as Parameters<typeof dialogCloseClick>[0];
 * const state = {} as Parameters<typeof dialogCloseClick>[1];
 * const options = {} as Parameters<typeof dialogCloseClick>[2];
 * const result = dialogCloseClick(input, state, options);
 * ```
 *
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
 * const input = {} as Parameters<typeof dialogCancel>[0];
 * const state = {} as Parameters<typeof dialogCancel>[1];
 * const options = {} as Parameters<typeof dialogCancel>[2];
 * const result = dialogCancel(input, state, options);
 * ```
 *
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
 * const input = {} as Parameters<typeof dialogBeforeToggle>[0];
 * const state = {} as Parameters<typeof dialogBeforeToggle>[1];
 * const options = {} as Parameters<typeof dialogBeforeToggle>[2];
 * const result = dialogBeforeToggle(input, state, options);
 * ```
 *
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
  if (event.newState !== 'open' && event.newState !== 'closed') return;

  const result = setDialogOpen(state, event.newState === 'open', 'native-beforetoggle', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}
