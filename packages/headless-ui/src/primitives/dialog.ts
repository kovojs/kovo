import {
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  openState,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

export type DialogChangeReason =
  | 'cancel-event'
  | 'close-click'
  | 'native-beforetoggle'
  | 'programmatic'
  | 'trigger-click';

export type DialogChangeDetail = PrimitiveChangeDetail<DialogChangeReason, boolean>;

export interface DialogState {
  disabled?: boolean;
  open: boolean;
}

export interface DialogAttributeOptions extends DialogState {
  contentId?: string;
  descriptionId?: string;
  titleId?: string;
}

export interface DialogChangeOptions {
  onOpenChange?: (detail: DialogChangeDetail) => void;
}

export interface DialogChangeResult {
  changed: boolean;
  detail?: DialogChangeDetail;
  open: boolean;
}

export type DialogPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

export type DialogTriggerEvent = Event;

export type DialogCloseEvent = Event;

export type DialogCancelEvent = Event;

export type DialogBeforeToggleEvent = Event &
  Readonly<{
    newState?: 'closed' | 'open';
  }>;

export function dialogRootAttributes(state: DialogState): DialogPrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(openState(state.open), dataDisabled(state.disabled === true)),
  });
}

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

export function dialogContentAttributes(
  options: DialogAttributeOptions,
): DialogPrimitiveAttributes {
  return Object.freeze({
    ...openState(options.open),
    open: options.open,
    ...(options.contentId === undefined ? {} : { id: options.contentId }),
    ...(options.titleId === undefined ? {} : { 'aria-labelledby': options.titleId }),
    ...(options.descriptionId === undefined ? {} : { 'aria-describedby': options.descriptionId }),
  });
}

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

export function toggleDialog(
  state: DialogState,
  reason: DialogChangeReason,
  options: DialogChangeOptions = {},
): DialogChangeResult {
  return setDialogOpen(state, !state.open, reason, options);
}

/**
 * @jisoPrimitiveHandler
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
export function dialogCloseClick(
  event: DialogCloseEvent,
  state: DialogState,
  options: DialogChangeOptions = {},
): DialogChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = setDialogOpen(state, false, 'close-click', options);
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
 * @jisoPrimitiveHandler
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
