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

/**
 * Public interface used by the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandItem } from '@kovojs/headless-ui/command';
 *
 * const value: CommandItem = {} as CommandItem;
 * ```
 */
export interface CommandItem {
  disabled?: boolean;
  id?: string;
  keywords?: readonly string[];
  label?: string;
  textValue?: string;
  value: string;
}

/**
 * State snapshot consumed by the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandState } from '@kovojs/headless-ui/command';
 *
 * const value: CommandState = {} as CommandState;
 * ```
 */
export interface CommandState {
  disabled?: boolean;
  form?: string;
  highlightedValue?: string;
  inputValue?: string;
  invalid?: boolean;
  items?: readonly CommandItem[];
  name?: string;
  open?: boolean;
  placeholder?: string;
  required?: boolean;
  value?: string;
}

/**
 * Options accepted by the Command primitive command root attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandRootAttributeOptions } from '@kovojs/headless-ui/command';
 *
 * const value: CommandRootAttributeOptions = {} as CommandRootAttributeOptions;
 * ```
 */
export interface CommandRootAttributeOptions extends CommandState {
  id?: string;
}

/**
 * Options accepted by the Command primitive command trigger attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandTriggerAttributeOptions } from '@kovojs/headless-ui/command';
 *
 * const value: CommandTriggerAttributeOptions = {} as CommandTriggerAttributeOptions;
 * ```
 */
export interface CommandTriggerAttributeOptions extends CommandState {
  contentId?: string;
  id?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Command primitive command dialog attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandDialogAttributeOptions } from '@kovojs/headless-ui/command';
 *
 * const value: CommandDialogAttributeOptions = {} as CommandDialogAttributeOptions;
 * ```
 */
export interface CommandDialogAttributeOptions extends CommandState {
  contentId?: string;
  descriptionId?: string;
  titleId?: string;
}

/**
 * Options accepted by the Command primitive command close attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandCloseAttributeOptions } from '@kovojs/headless-ui/command';
 *
 * const value: CommandCloseAttributeOptions = {} as CommandCloseAttributeOptions;
 * ```
 */
export interface CommandCloseAttributeOptions extends CommandState {
  contentId?: string;
}

/**
 * Options accepted by the Command primitive command input attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandInputAttributeOptions } from '@kovojs/headless-ui/command';
 *
 * const value: CommandInputAttributeOptions = {} as CommandInputAttributeOptions;
 * ```
 */
export interface CommandInputAttributeOptions extends CommandState {
  autocomplete?: string;
  descriptionId?: string;
  id?: string;
  labelledBy?: string;
  listboxId?: string;
}

/**
 * Options accepted by the Command primitive command listbox attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandListboxAttributeOptions } from '@kovojs/headless-ui/command';
 *
 * const value: CommandListboxAttributeOptions = {} as CommandListboxAttributeOptions;
 * ```
 */
export interface CommandListboxAttributeOptions extends CommandState {
  id?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Command primitive command item attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandItemAttributeOptions } from '@kovojs/headless-ui/command';
 *
 * const value: CommandItemAttributeOptions = {} as CommandItemAttributeOptions;
 * ```
 */
export interface CommandItemAttributeOptions extends CommandState {
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

/**
 * Options accepted by the Command primitive command empty attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandEmptyAttributeOptions } from '@kovojs/headless-ui/command';
 *
 * const value: CommandEmptyAttributeOptions = {} as CommandEmptyAttributeOptions;
 * ```
 */
export interface CommandEmptyAttributeOptions extends CommandState {
  id?: string;
}

/**
 * Reason token reported by the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandOpenChangeReason } from '@kovojs/headless-ui/command';
 *
 * const value: CommandOpenChangeReason = {} as CommandOpenChangeReason;
 * ```
 */
export type CommandOpenChangeReason =
  | 'cancel-event'
  | 'close-click'
  | 'escape-key'
  | 'item-select'
  | 'native-beforetoggle'
  | 'programmatic'
  | 'trigger-click';

/**
 * Reason token reported by the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandInputChangeReason } from '@kovojs/headless-ui/command';
 *
 * const value: CommandInputChangeReason = {} as CommandInputChangeReason;
 * ```
 */
export type CommandInputChangeReason = 'input' | 'programmatic';

/**
 * Reason token reported by the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandValueChangeReason } from '@kovojs/headless-ui/command';
 *
 * const value: CommandValueChangeReason = {} as CommandValueChangeReason;
 * ```
 */
export type CommandValueChangeReason = 'enter-key' | 'item-click' | 'programmatic';

/**
 * Cancelable change detail emitted by the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandOpenChangeDetail } from '@kovojs/headless-ui/command';
 *
 * const value: CommandOpenChangeDetail = {} as CommandOpenChangeDetail;
 * ```
 */
export type CommandOpenChangeDetail = PrimitiveChangeDetail<CommandOpenChangeReason, boolean>;

/**
 * Cancelable change detail emitted by the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandInputChangeDetail } from '@kovojs/headless-ui/command';
 *
 * const value: CommandInputChangeDetail = {} as CommandInputChangeDetail;
 * ```
 */
export type CommandInputChangeDetail = PrimitiveChangeDetail<CommandInputChangeReason, string>;

/**
 * Cancelable change detail emitted by the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandValueChangeDetail } from '@kovojs/headless-ui/command';
 *
 * const value: CommandValueChangeDetail = {} as CommandValueChangeDetail;
 * ```
 */
export type CommandValueChangeDetail = PrimitiveChangeDetail<
  CommandValueChangeReason,
  string | undefined
>;

/**
 * Options accepted by the Command primitive command change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandChangeOptions } from '@kovojs/headless-ui/command';
 *
 * const value: CommandChangeOptions = {} as CommandChangeOptions;
 * ```
 */
export interface CommandChangeOptions {
  onInputChange?: (detail: CommandInputChangeDetail) => void;
  onOpenChange?: (detail: CommandOpenChangeDetail) => void;
  onValueChange?: (detail: CommandValueChangeDetail) => void;
}

/**
 * Result returned by the Command primitive command open change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandOpenChangeResult } from '@kovojs/headless-ui/command';
 *
 * const value: CommandOpenChangeResult = {} as CommandOpenChangeResult;
 * ```
 */
export interface CommandOpenChangeResult {
  changed: boolean;
  detail?: CommandOpenChangeDetail;
  open: boolean;
}

/**
 * Result returned by the Command primitive command input change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandInputChangeResult } from '@kovojs/headless-ui/command';
 *
 * const value: CommandInputChangeResult = {} as CommandInputChangeResult;
 * ```
 */
export interface CommandInputChangeResult {
  changed: boolean;
  detail?: CommandInputChangeDetail;
  inputValue: string;
}

/**
 * Result returned by the Command primitive command value change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandValueChangeResult } from '@kovojs/headless-ui/command';
 *
 * const value: CommandValueChangeResult = {} as CommandValueChangeResult;
 * ```
 */
export interface CommandValueChangeResult {
  changed: boolean;
  detail?: CommandValueChangeDetail;
  value: string | undefined;
}

/**
 * Result returned by the Command primitive command select.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandSelectResult } from '@kovojs/headless-ui/command';
 *
 * const value: CommandSelectResult = {} as CommandSelectResult;
 * ```
 */
export interface CommandSelectResult {
  open: CommandOpenChangeResult;
  selected: boolean;
  value: CommandValueChangeResult;
}

/**
 * Result returned by the Command primitive command move.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandMoveResult } from '@kovojs/headless-ui/command';
 *
 * const value: CommandMoveResult = {} as CommandMoveResult;
 * ```
 */
export interface CommandMoveResult {
  highlightedIndex: number;
  highlightedValue: string | undefined;
}

/**
 * Result returned by the Command primitive command keyboard.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandKeyboardResult } from '@kovojs/headless-ui/command';
 *
 * const value: CommandKeyboardResult = {} as CommandKeyboardResult;
 * ```
 */
export type CommandKeyboardResult =
  | CommandMoveResult
  | CommandOpenChangeResult
  | CommandSelectResult;

/**
 * Serializable attribute record returned by Command primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandPrimitiveAttributes } from '@kovojs/headless-ui/command';
 *
 * const value: CommandPrimitiveAttributes = {} as CommandPrimitiveAttributes;
 * ```
 */
export type CommandPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

/**
 * Event shape consumed by the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandTriggerEvent } from '@kovojs/headless-ui/command';
 *
 * const value: CommandTriggerEvent = {} as CommandTriggerEvent;
 * ```
 */
export type CommandTriggerEvent = Event;

/**
 * Event shape consumed by the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandCloseEvent } from '@kovojs/headless-ui/command';
 *
 * const value: CommandCloseEvent = {} as CommandCloseEvent;
 * ```
 */
export type CommandCloseEvent = Event;

/**
 * Event shape consumed by the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandCancelEvent } from '@kovojs/headless-ui/command';
 *
 * const value: CommandCancelEvent = {} as CommandCancelEvent;
 * ```
 */
export type CommandCancelEvent = Event;

/**
 * Event shape consumed by the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandItemEvent } from '@kovojs/headless-ui/command';
 *
 * const value: CommandItemEvent = {} as CommandItemEvent;
 * ```
 */
export type CommandItemEvent = Event;

/**
 * Event shape consumed by the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandInputEvent } from '@kovojs/headless-ui/command';
 *
 * const value: CommandInputEvent = {} as CommandInputEvent;
 * ```
 */
export type CommandInputEvent = Event & {
  readonly currentTarget: (EventTarget & { value?: string }) | null;
  readonly target?: (EventTarget & { value?: string }) | null;
};

/**
 * Event shape consumed by the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandKeyboardEvent } from '@kovojs/headless-ui/command';
 *
 * const value: CommandKeyboardEvent = {} as CommandKeyboardEvent;
 * ```
 */
export type CommandKeyboardEvent = Event & { readonly key: string };

/**
 * Event shape consumed by the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CommandBeforeToggleEvent } from '@kovojs/headless-ui/command';
 *
 * const value: CommandBeforeToggleEvent = {} as CommandBeforeToggleEvent;
 * ```
 */
export type CommandBeforeToggleEvent = Event &
  Readonly<{
    newState?: 'closed' | 'open';
  }>;

/**
 * Builds the command root attributes record for the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { commandRootAttributes } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandRootAttributes>[0];
 * const result = commandRootAttributes(input);
 * ```
 */
export function commandRootAttributes(
  options: CommandRootAttributeOptions = {},
): CommandPrimitiveAttributes {
  return Object.freeze({
    ...commandDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Builds the command trigger attributes record for the Command primitive.
 *
 * Emits `aria-controls`, `aria-expanded`, `aria-haspopup`, `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { commandTriggerAttributes } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandTriggerAttributes>[0];
 * const result = commandTriggerAttributes(input);
 * ```
 */
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

/**
 * Builds the command dialog attributes record for the Command primitive.
 *
 * Emits `aria-describedby`, `aria-labelledby`, `aria-modal`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { commandDialogAttributes } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandDialogAttributes>[0];
 * const result = commandDialogAttributes(input);
 * ```
 */
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

/**
 * Builds the command close attributes record for the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { commandCloseAttributes } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandCloseAttributes>[0];
 * const result = commandCloseAttributes(input);
 * ```
 */
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

/**
 * Builds the command input attributes record for the Command primitive.
 *
 * Emits `aria-autocomplete`, `aria-expanded`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { commandInputAttributes } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandInputAttributes>[0];
 * const result = commandInputAttributes(input);
 * ```
 */
export function commandInputAttributes(
  options: CommandInputAttributeOptions = {},
): CommandPrimitiveAttributes {
  const activeDescendant = commandActiveDescendant(options);

  // SPEC.md §6.3: form() typing validates real named controls; command keeps
  // its native text input as the submitted search/query control.
  return Object.freeze({
    ...commandDataAttributes(options),
    'aria-autocomplete': 'list',
    'aria-expanded': String(options.open === true),
    autocomplete: options.autocomplete ?? 'off',
    role: 'combobox',
    type: 'text',
    value: options.inputValue ?? '',
    ...(activeDescendant === undefined ? {} : { 'aria-activedescendant': activeDescendant }),
    ...(options.listboxId === undefined ? {} : { 'aria-controls': options.listboxId }),
    ...(options.descriptionId === undefined ? {} : { 'aria-describedby': options.descriptionId }),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(options.invalid === true ? { 'aria-invalid': 'true' } : {}),
    disabled: options.disabled === true,
    ...(options.form === undefined ? {} : { form: options.form }),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.placeholder === undefined ? {} : { placeholder: options.placeholder }),
    ...(options.required === true ? { required: true } : {}),
  });
}

/**
 * Builds the command listbox attributes record for the Command primitive.
 *
 * Emits `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { commandListboxAttributes } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandListboxAttributes>[0];
 * const result = commandListboxAttributes(input);
 * ```
 */
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

/**
 * Builds the command item attributes record for the Command primitive.
 *
 * Emits `aria-disabled`, `aria-selected`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { commandItemAttributes } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandItemAttributes>[0];
 * const result = commandItemAttributes(input);
 * ```
 */
export function commandItemAttributes(
  options: CommandItemAttributeOptions,
): CommandPrimitiveAttributes {
  const disabled = commandItemDisabled(options, options.itemValue);
  const highlighted = commandItemHighlighted(options);
  // bugz-3 M13 (SPEC.md §4.6): resolve a stable option id (explicit id → item id
  // → synthesized fallback) so the id commandActiveDescendant references is
  // actually carried by the rendered option. Previously only explicit ids were
  // emitted, so the `aria-activedescendant` fallback dangled (getElementById →
  // null). Mirrors comboboxOptionId/selectOptionId/autocompleteOptionId.
  const id = commandOptionId(options, options.itemValue);

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

/**
 * Builds the command empty attributes record for the Command primitive.
 *
 * Emits `data-empty`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { commandEmptyAttributes } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandEmptyAttributes>[0];
 * const result = commandEmptyAttributes(input);
 * ```
 */
export function commandEmptyAttributes(
  options: CommandEmptyAttributeOptions = {},
): CommandPrimitiveAttributes {
  return Object.freeze({
    'data-empty': '',
    ...(commandFilteredItems(options).length === 0 ? {} : { hidden: true }),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Computes command item highlighted for the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { commandItemHighlighted } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandItemHighlighted>[0];
 * const result = commandItemHighlighted(input);
 * ```
 */
export function commandItemHighlighted(options: CommandItemAttributeOptions): boolean {
  return options.highlightedValue === options.itemValue;
}

/**
 * Computes command item selected for the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { commandItemSelected } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandItemSelected>[0];
 * const result = commandItemSelected(input);
 * ```
 */
export function commandItemSelected(options: CommandItemAttributeOptions): boolean {
  return options.value === options.itemValue;
}

/**
 * Computes command value text for the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { commandValueText } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandValueText>[0];
 * const result = commandValueText(input);
 * ```
 */
export function commandValueText(state: CommandState): string {
  const selected = state.items?.find((item) => item.value === state.value);
  if (selected) return selected.label ?? selected.textValue ?? selected.value;
  return state.value ?? '';
}

/**
 * Computes command filtered items for the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { commandFilteredItems } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandFilteredItems>[0];
 * const result = commandFilteredItems(input);
 * ```
 */
export function commandFilteredItems(state: CommandState): readonly CommandItem[] {
  const query = normalizeCommandQuery(state.inputValue);
  const items = state.items ?? [];
  if (query === '') return items;

  return Object.freeze(items.filter((item) => commandItemMatches(item, query)));
}

/**
 * Computes the set command open transition for the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setCommandOpen } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof setCommandOpen>[0];
 * const state = {} as Parameters<typeof setCommandOpen>[1];
 * const options = {} as Parameters<typeof setCommandOpen>[2];
 * const detail = {} as Parameters<typeof setCommandOpen>[3];
 * const result = setCommandOpen(input, state, options, detail);
 * ```
 */
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

/**
 * Computes the set command input value transition for the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setCommandInputValue } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof setCommandInputValue>[0];
 * const state = {} as Parameters<typeof setCommandInputValue>[1];
 * const options = {} as Parameters<typeof setCommandInputValue>[2];
 * const detail = {} as Parameters<typeof setCommandInputValue>[3];
 * const result = setCommandInputValue(input, state, options, detail);
 * ```
 */
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

/**
 * Computes the set command value transition for the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setCommandValue } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof setCommandValue>[0];
 * const state = {} as Parameters<typeof setCommandValue>[1];
 * const options = {} as Parameters<typeof setCommandValue>[2];
 * const detail = {} as Parameters<typeof setCommandValue>[3];
 * const result = setCommandValue(input, state, options, detail);
 * ```
 */
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

/**
 * Computes the toggle command transition for the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleCommand } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof toggleCommand>[0];
 * const state = {} as Parameters<typeof toggleCommand>[1];
 * const options = {} as Parameters<typeof toggleCommand>[2];
 * const result = toggleCommand(input, state, options);
 * ```
 */
export function toggleCommand(
  state: CommandState,
  reason: CommandOpenChangeReason,
  options: CommandChangeOptions = {},
): CommandOpenChangeResult {
  return setCommandOpen(state, !(state.open === true), reason, options);
}

/**
 * Computes the select command item transition for the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { selectCommandItem } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof selectCommandItem>[0];
 * const state = {} as Parameters<typeof selectCommandItem>[1];
 * const options = {} as Parameters<typeof selectCommandItem>[2];
 * const detail = {} as Parameters<typeof selectCommandItem>[3];
 * const result = selectCommandItem(input, state, options, detail);
 * ```
 */
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

/**
 * Computes command move for the Command primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { commandMove } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandMove>[0];
 * const state = {} as Parameters<typeof commandMove>[1];
 * const options = {} as Parameters<typeof commandMove>[2];
 * const result = commandMove(input, state, options);
 * ```
 */
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
 * Handles the command trigger click interaction for the Command primitive.
 *
 * @example
 * ```ts
 * import { commandTriggerClick } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandTriggerClick>[0];
 * const state = {} as Parameters<typeof commandTriggerClick>[1];
 * const options = {} as Parameters<typeof commandTriggerClick>[2];
 * const result = commandTriggerClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the command close click interaction for the Command primitive.
 *
 * @example
 * ```ts
 * import { commandCloseClick } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandCloseClick>[0];
 * const state = {} as Parameters<typeof commandCloseClick>[1];
 * const options = {} as Parameters<typeof commandCloseClick>[2];
 * const result = commandCloseClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the command cancel interaction for the Command primitive.
 *
 * @example
 * ```ts
 * import { commandCancel } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandCancel>[0];
 * const state = {} as Parameters<typeof commandCancel>[1];
 * const options = {} as Parameters<typeof commandCancel>[2];
 * const result = commandCancel(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the command before toggle interaction for the Command primitive.
 *
 * @example
 * ```ts
 * import { commandBeforeToggle } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandBeforeToggle>[0];
 * const state = {} as Parameters<typeof commandBeforeToggle>[1];
 * const options = {} as Parameters<typeof commandBeforeToggle>[2];
 * const result = commandBeforeToggle(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the command input interaction for the Command primitive.
 *
 * @example
 * ```ts
 * import { commandInput } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandInput>[0];
 * const state = {} as Parameters<typeof commandInput>[1];
 * const options = {} as Parameters<typeof commandInput>[2];
 * const result = commandInput(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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

  const inputTarget = event.target ?? event.currentTarget;
  const result = setCommandInputValue(state, inputTarget?.value ?? '', 'input', options);
  if (!result.changed) {
    if (inputTarget) inputTarget.value = result.inputValue;
    if (event.currentTarget && event.currentTarget !== inputTarget) {
      event.currentTarget.value = result.inputValue;
    }
    event.preventDefault();
  }

  return result;
}

/**
 * Handles the command item click interaction for the Command primitive.
 *
 * @example
 * ```ts
 * import { commandItemClick } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandItemClick>[0];
 * const state = {} as Parameters<typeof commandItemClick>[1];
 * const options = {} as Parameters<typeof commandItemClick>[2];
 * const result = commandItemClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the command key down interaction for the Command primitive.
 *
 * @example
 * ```ts
 * import { commandKeyDown } from '@kovojs/headless-ui/command';
 *
 * const input = {} as Parameters<typeof commandKeyDown>[0];
 * const state = {} as Parameters<typeof commandKeyDown>[1];
 * const options = {} as Parameters<typeof commandKeyDown>[2];
 * const result = commandKeyDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
    state.invalid === true ? { 'data-invalid': '' } : undefined,
    state.required === true ? { 'data-required': '' } : undefined,
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

  return commandFallbackOptionId(options, options.highlightedValue);
}

function commandItemId(state: CommandState, value: string): string | undefined {
  return state.items?.find((item) => item.value === value)?.id;
}

function commandOptionId(options: CommandItemAttributeOptions, value: string): string | undefined {
  if (options.id !== undefined) return options.id;
  const itemId = commandItemId(options, value);
  if (itemId !== undefined) return itemId;
  return commandFallbackOptionId(options, value);
}

function commandFallbackOptionId(
  state: CommandState & { id?: string; listboxId?: string },
  value: string,
): string | undefined {
  // bugz-3 M13/L17 (SPEC.md §4.6): use a SINGLE index space — the *filtered*
  // render order (the items the listbox actually shows). A value outside that
  // order gets no synthesized id (returns undefined) rather than a colliding one.
  // Both commandActiveDescendant and commandItemAttributes resolve the same
  // `state`, so the synthesized id the input references is the one the option
  // carries (previously commandItemAttributes emitted no fallback id at all).
  const index = commandFilteredItems(state).findIndex((item) => item.value === value);
  if (index < 0) return undefined;
  return `${commandFallbackPrefix(state)}-item-${index}`;
}

// bugz-3 L17 (SPEC.md §4.6): derive a per-instance-unique id prefix. Prefer the
// app-provided listboxId; otherwise fingerprint the item set so two id-less
// command palettes on one page do not both synthesize `command-item-0`. The input
// (aria-activedescendant) and every item see the same `state.items`, so the
// fingerprint is identical within an instance and the IDREF resolves. `state.id`
// is intentionally NOT used: it is the *input* id on the active-descendant path
// but the *item* id on the option path, which would diverge.
function commandFallbackPrefix(state: {
  items?: readonly CommandItem[];
  listboxId?: string;
}): string {
  if (state.listboxId !== undefined) return state.listboxId;
  return `command-${optionSetFingerprint(state.items)}`;
}

// Deterministic FNV-1a-32 fingerprint of the item set (value + label +
// textValue), base36-encoded. Stable across calls within one render and distinct
// for differing item sets, so synthesized ids are unique across instances.
function optionSetFingerprint(
  items: readonly { value: string; label?: string; textValue?: string }[] | undefined,
): string {
  let hash = 0x811c9dc5;
  const seed = (items ?? [])
    .map((item) => `${item.value} ${item.label ?? ''} ${item.textValue ?? ''}`)
    .join('');
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
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
