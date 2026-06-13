import {
  dataDisabled,
  dataState,
  dispatchCancelableChange,
  mergeDataAttributes,
  moveCollectionIndex,
  navigationIntentFromKey,
  openState,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

export interface CommandItem {
  disabled?: boolean;
  id?: string;
  keywords?: readonly string[];
  label?: string;
  textValue?: string;
  value: string;
}

export interface CommandState {
  disabled?: boolean;
  highlightedValue?: string;
  inputValue?: string;
  items?: readonly CommandItem[];
  open?: boolean;
  placeholder?: string;
  value?: string;
}

export interface CommandRootAttributeOptions extends CommandState {
  id?: string;
}

export interface CommandTriggerAttributeOptions extends CommandState {
  contentId?: string;
  id?: string;
  labelledBy?: string;
}

export interface CommandDialogAttributeOptions extends CommandState {
  contentId?: string;
  descriptionId?: string;
  titleId?: string;
}

export interface CommandCloseAttributeOptions extends CommandState {
  contentId?: string;
}

export interface CommandInputAttributeOptions extends CommandState {
  descriptionId?: string;
  id?: string;
  labelledBy?: string;
  listboxId?: string;
}

export interface CommandListboxAttributeOptions extends CommandState {
  id?: string;
  labelledBy?: string;
}

export interface CommandItemAttributeOptions extends CommandState {
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

export interface CommandEmptyAttributeOptions extends CommandState {
  id?: string;
}

export type CommandOpenChangeReason =
  | 'cancel-event'
  | 'close-click'
  | 'escape-key'
  | 'item-select'
  | 'native-beforetoggle'
  | 'programmatic'
  | 'trigger-click';

export type CommandInputChangeReason = 'input' | 'programmatic';

export type CommandValueChangeReason = 'enter-key' | 'item-click' | 'programmatic';

export type CommandOpenChangeDetail = PrimitiveChangeDetail<CommandOpenChangeReason, boolean>;

export type CommandInputChangeDetail = PrimitiveChangeDetail<CommandInputChangeReason, string>;

export type CommandValueChangeDetail = PrimitiveChangeDetail<
  CommandValueChangeReason,
  string | undefined
>;

export interface CommandChangeOptions {
  onInputChange?: (detail: CommandInputChangeDetail) => void;
  onOpenChange?: (detail: CommandOpenChangeDetail) => void;
  onValueChange?: (detail: CommandValueChangeDetail) => void;
}

export interface CommandOpenChangeResult {
  changed: boolean;
  detail?: CommandOpenChangeDetail;
  open: boolean;
}

export interface CommandInputChangeResult {
  changed: boolean;
  detail?: CommandInputChangeDetail;
  inputValue: string;
}

export interface CommandValueChangeResult {
  changed: boolean;
  detail?: CommandValueChangeDetail;
  value: string | undefined;
}

export interface CommandSelectResult {
  open: CommandOpenChangeResult;
  selected: boolean;
  value: CommandValueChangeResult;
}

export interface CommandMoveResult {
  highlightedIndex: number;
  highlightedValue: string | undefined;
}

export type CommandKeyboardResult =
  | CommandMoveResult
  | CommandOpenChangeResult
  | CommandSelectResult;

export type CommandPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type CommandTriggerEvent = Event;
export type CommandCloseEvent = Event;
export type CommandCancelEvent = Event;
export type CommandItemEvent = Event;
export type CommandInputEvent = Event & {
  readonly currentTarget: EventTarget & { value?: string };
};
export type CommandKeyboardEvent = Event & { readonly key: string };
export type CommandBeforeToggleEvent = Event &
  Readonly<{
    newState?: 'closed' | 'open';
  }>;

export function commandRootAttributes(
  options: CommandRootAttributeOptions = {},
): CommandPrimitiveAttributes {
  return Object.freeze({
    ...commandDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function commandTriggerAttributes(
  options: CommandTriggerAttributeOptions = {},
): CommandPrimitiveAttributes {
  const enabledContentId = options.disabled === true ? undefined : options.contentId;

  return Object.freeze({
    ...commandDataAttributes(options),
    'aria-expanded': String(options.open === true),
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
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
  });
}

export function commandDialogAttributes(
  options: CommandDialogAttributeOptions = {},
): CommandPrimitiveAttributes {
  return Object.freeze({
    ...commandDataAttributes(options),
    'aria-modal': 'true',
    ...(options.contentId === undefined ? {} : { id: options.contentId }),
    ...(options.descriptionId === undefined ? {} : { 'aria-describedby': options.descriptionId }),
    ...(options.titleId === undefined ? {} : { 'aria-labelledby': options.titleId }),
    open: options.open === true,
  });
}

export function commandCloseAttributes(
  options: CommandCloseAttributeOptions = {},
): CommandPrimitiveAttributes {
  const enabledContentId = options.disabled === true ? undefined : options.contentId;

  return Object.freeze({
    ...commandDataAttributes(options),
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

export function commandInputAttributes(
  options: CommandInputAttributeOptions = {},
): CommandPrimitiveAttributes {
  const activeDescendant = commandActiveDescendant(options);

  return Object.freeze({
    ...commandDataAttributes(options),
    'aria-autocomplete': 'list',
    'aria-expanded': String(options.open === true),
    role: 'combobox',
    type: 'text',
    value: options.inputValue ?? '',
    ...(activeDescendant === undefined ? {} : { 'aria-activedescendant': activeDescendant }),
    ...(options.listboxId === undefined ? {} : { 'aria-controls': options.listboxId }),
    ...(options.descriptionId === undefined ? {} : { 'aria-describedby': options.descriptionId }),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    disabled: options.disabled === true,
    ...(options.placeholder === undefined ? {} : { placeholder: options.placeholder }),
  });
}

export function commandListboxAttributes(
  options: CommandListboxAttributeOptions = {},
): CommandPrimitiveAttributes {
  return Object.freeze({
    ...commandDataAttributes(options),
    role: 'listbox',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(options.open === true ? {} : { hidden: true }),
  });
}

export function commandItemAttributes(
  options: CommandItemAttributeOptions,
): CommandPrimitiveAttributes {
  const disabled = commandItemDisabled(options, options.itemValue);
  const highlighted = commandItemHighlighted(options);
  const id = options.id ?? commandItemId(options, options.itemValue);

  return Object.freeze({
    ...commandItemDataAttributes(options),
    'aria-selected': String(highlighted),
    role: 'option',
    tabIndex: highlighted && !disabled ? 0 : -1,
    ...(id === undefined ? {} : { id }),
    ...(disabled ? { 'aria-disabled': 'true' } : {}),
    ...(options.itemLabel === undefined ? {} : { label: options.itemLabel }),
    value: options.itemValue,
  });
}

export function commandEmptyAttributes(
  options: CommandEmptyAttributeOptions = {},
): CommandPrimitiveAttributes {
  return Object.freeze({
    'data-empty': '',
    ...(commandFilteredItems(options).length === 0 ? {} : { hidden: true }),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function commandItemHighlighted(options: CommandItemAttributeOptions): boolean {
  return options.highlightedValue === options.itemValue;
}

export function commandItemSelected(options: CommandItemAttributeOptions): boolean {
  return options.value === options.itemValue;
}

export function commandValueText(state: CommandState): string {
  const selected = state.items?.find((item) => item.value === state.value);
  if (selected) return selected.label ?? selected.textValue ?? selected.value;
  return state.value ?? '';
}

export function commandFilteredItems(state: CommandState): readonly CommandItem[] {
  const query = normalizeCommandQuery(state.inputValue);
  const items = state.items ?? [];
  if (query === '') return items;

  return Object.freeze(items.filter((item) => commandItemMatches(item, query)));
}

export function setCommandOpen(
  state: CommandState,
  open: boolean,
  reason: CommandOpenChangeReason,
  options: CommandChangeOptions = {},
): CommandOpenChangeResult {
  if (state.disabled || state.open === open) {
    return { changed: false, open: state.open === true };
  }

  const detail = dispatchCancelableChange({ reason, value: open }, options.onOpenChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, open: state.open === true };
  }

  return { changed: true, detail, open };
}

export function setCommandInputValue(
  state: CommandState,
  inputValue: string,
  reason: CommandInputChangeReason,
  options: CommandChangeOptions = {},
): CommandInputChangeResult {
  const currentValue = state.inputValue ?? '';
  if (state.disabled || currentValue === inputValue) {
    return { changed: false, inputValue: currentValue };
  }

  const detail = dispatchCancelableChange({ reason, value: inputValue }, options.onInputChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, inputValue: currentValue };
  }

  return { changed: true, detail, inputValue };
}

export function setCommandValue(
  state: CommandState,
  value: string | undefined,
  reason: CommandValueChangeReason,
  options: CommandChangeOptions = {},
): CommandValueChangeResult {
  if (state.disabled || state.value === value || commandValueDisabled(state, value)) {
    return { changed: false, value: state.value };
  }

  const detail = dispatchCancelableChange({ reason, value }, options.onValueChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, value: state.value };
  }

  return { changed: true, detail, value };
}

export function toggleCommand(
  state: CommandState,
  reason: CommandOpenChangeReason,
  options: CommandChangeOptions = {},
): CommandOpenChangeResult {
  return setCommandOpen(state, !(state.open === true), reason, options);
}

export function selectCommandItem(
  state: CommandState,
  value: string | undefined,
  reason: CommandValueChangeReason,
  options: CommandChangeOptions = {},
): CommandSelectResult {
  const valueResult = setCommandValue(state, value, reason, options);
  if (!valueResult.changed) {
    return {
      open: { changed: false, open: state.open === true },
      selected: false,
      value: valueResult,
    };
  }

  const openResult = setCommandOpen(state, false, 'item-select', options);
  if (!openResult.changed) {
    return {
      open: openResult,
      selected: false,
      value: {
        changed: false,
        ...(valueResult.detail === undefined ? {} : { detail: valueResult.detail }),
        value: state.value,
      },
    };
  }

  return {
    open: openResult,
    selected: true,
    value: valueResult,
  };
}

export function commandMove(
  state: CommandState,
  key: string,
  options: { loop?: boolean } = {},
): CommandMoveResult | undefined {
  if (state.disabled) return undefined;

  const intent = navigationIntentFromKey(key, { orientation: 'vertical' });
  if (intent === undefined) return undefined;

  const items = commandFilteredItems(state);
  const currentIndex = items.findIndex((item) => item.value === state.highlightedValue);
  const highlightedIndex = moveCollectionIndex(intent, {
    currentIndex,
    items,
    ...(options.loop === undefined ? {} : { loop: options.loop }),
  });

  return {
    highlightedIndex,
    highlightedValue: highlightedIndex < 0 ? undefined : items[highlightedIndex]?.value,
  };
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function commandTriggerClick(
  event: CommandTriggerEvent,
  state: CommandState,
  options: CommandChangeOptions = {},
): CommandOpenChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = setCommandOpen(state, true, 'trigger-click', options);
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
export function commandCloseClick(
  event: CommandCloseEvent,
  state: CommandState,
  options: CommandChangeOptions = {},
): CommandOpenChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = setCommandOpen(state, false, 'close-click', options);
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
export function commandCancel(
  event: CommandCancelEvent,
  state: CommandState,
  options: CommandChangeOptions = {},
): CommandOpenChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = setCommandOpen(state, false, 'cancel-event', options);
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
export function commandBeforeToggle(
  event: CommandBeforeToggleEvent,
  state: CommandState,
  options: CommandChangeOptions = {},
): CommandOpenChangeResult | undefined {
  if (event.defaultPrevented) return;
  if (event.newState !== 'open' && event.newState !== 'closed') return;

  const result = setCommandOpen(state, event.newState === 'open', 'native-beforetoggle', options);
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
export function commandInput(
  event: CommandInputEvent,
  state: CommandState,
  options: CommandChangeOptions = {},
): CommandInputChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = setCommandInputValue(state, event.currentTarget.value ?? '', 'input', options);
  if (!result.changed) {
    event.currentTarget.value = result.inputValue;
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
export function commandItemClick(
  event: CommandItemEvent,
  state: CommandItemAttributeOptions,
  options: CommandChangeOptions = {},
): CommandSelectResult | undefined {
  if (event.defaultPrevented) return;

  const result = selectCommandItem(state, state.itemValue, 'item-click', options);
  if (!result.selected) {
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
export function commandKeyDown(
  event: CommandKeyboardEvent,
  state: CommandState,
  options: CommandChangeOptions = {},
): CommandKeyboardResult | undefined {
  if (event.defaultPrevented) return;

  if (event.key === 'Escape') {
    const result = setCommandOpen(state, false, 'escape-key', options);
    if (result.changed || result.detail?.defaultPrevented === true) event.preventDefault();
    return result;
  }

  if (event.key === 'Enter' && state.highlightedValue !== undefined) {
    const result = selectCommandItem(state, state.highlightedValue, 'enter-key', options);
    if (
      result.selected ||
      result.value.detail?.defaultPrevented === true ||
      result.open.detail?.defaultPrevented === true
    ) {
      event.preventDefault();
    }
    return result;
  }

  const moveResult = commandMove(state, event.key, { loop: true });
  if (moveResult !== undefined) event.preventDefault();
  return moveResult;
}

function commandDataAttributes(state: CommandState): PrimitiveDataAttributes {
  return mergeDataAttributes(
    openState(state.open === true),
    dataDisabled(state.disabled === true),
    commandInputDataAttributes(state),
  );
}

function commandInputDataAttributes(state: CommandState): PrimitiveDataAttributes {
  return state.inputValue === undefined || state.inputValue === ''
    ? Object.freeze({ 'data-placeholder': '' })
    : Object.freeze({});
}

function commandItemDataAttributes(options: CommandItemAttributeOptions): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataState(commandItemHighlighted(options) ? 'active' : 'inactive'),
    dataDisabled(commandItemDisabled(options, options.itemValue)),
    commandItemSelected(options) ? { 'data-selected': '' } : undefined,
    commandItemHighlighted(options) ? { 'data-highlighted': '' } : undefined,
  );
}

function commandItemDisabled(
  state: CommandState & { itemDisabled?: boolean },
  value: string,
): boolean {
  return (
    state.disabled === true ||
    state.itemDisabled === true ||
    state.items?.find((item) => item.value === value)?.disabled === true
  );
}

function commandValueDisabled(state: CommandState, value: string | undefined): boolean {
  return value !== undefined && commandItemDisabled(state, value);
}

function commandActiveDescendant(options: CommandInputAttributeOptions): string | undefined {
  if (options.highlightedValue === undefined) return undefined;
  const itemId = commandItemId(options, options.highlightedValue);
  if (itemId !== undefined) return itemId;

  const index = commandFilteredItems(options).findIndex(
    (item) => item.value === options.highlightedValue,
  );
  if (index < 0) return undefined;

  return `${options.listboxId ?? options.id ?? 'command'}-item-${index}`;
}

function commandItemId(state: CommandState, value: string): string | undefined {
  return state.items?.find((item) => item.value === value)?.id;
}

function commandItemMatches(item: CommandItem, query: string): boolean {
  return commandSearchText(item).includes(query);
}

function commandSearchText(item: CommandItem): string {
  return [item.label, item.textValue, item.value, ...(item.keywords ?? [])]
    .filter((value): value is string => value !== undefined)
    .join(' ')
    .toLocaleLowerCase();
}

function normalizeCommandQuery(inputValue: string | undefined): string {
  return (inputValue ?? '').trim().toLocaleLowerCase();
}
