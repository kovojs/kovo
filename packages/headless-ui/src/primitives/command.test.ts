import { describe, expect, it } from 'vitest';

import {
  commandBeforeToggle as exportedCommandBeforeToggle,
  commandCancel as exportedCommandCancel,
  commandCloseAttributes as exportedCommandCloseAttributes,
  commandCloseClick as exportedCommandCloseClick,
  commandDialogAttributes as exportedCommandDialogAttributes,
  commandEmptyAttributes as exportedCommandEmptyAttributes,
  commandFilteredItems as exportedCommandFilteredItems,
  commandInput as exportedCommandInput,
  commandInputAttributes as exportedCommandInputAttributes,
  commandItemAttributes as exportedCommandItemAttributes,
  commandItemClick as exportedCommandItemClick,
  commandItemHighlighted as exportedCommandItemHighlighted,
  commandItemSelected as exportedCommandItemSelected,
  commandKeyDown as exportedCommandKeyDown,
  commandListboxAttributes as exportedCommandListboxAttributes,
  commandMove as exportedCommandMove,
  commandRootAttributes as exportedCommandRootAttributes,
  commandTriggerAttributes as exportedCommandTriggerAttributes,
  commandTriggerClick as exportedCommandTriggerClick,
  commandValueText as exportedCommandValueText,
  selectCommandItem as exportedSelectCommandItem,
  setCommandInputValue as exportedSetCommandInputValue,
  setCommandOpen as exportedSetCommandOpen,
  setCommandValue as exportedSetCommandValue,
  toggleCommand as exportedToggleCommand,
} from '../index.js';
import {
  commandBeforeToggle,
  commandCancel,
  commandCloseAttributes,
  commandCloseClick,
  commandDialogAttributes,
  commandEmptyAttributes,
  commandFilteredItems,
  commandInput,
  commandInputAttributes,
  commandItemAttributes,
  commandItemClick,
  commandItemHighlighted,
  commandItemSelected,
  commandKeyDown,
  commandListboxAttributes,
  commandMove,
  commandRootAttributes,
  commandTriggerAttributes,
  commandTriggerClick,
  commandValueText,
  selectCommandItem,
  setCommandInputValue,
  setCommandOpen,
  setCommandValue,
  toggleCommand,
  type CommandItem,
} from './command.js';
import { commandRootAttributes as primitiveCommandRootAttributes } from './index.js';

const commandItems: readonly CommandItem[] = Object.freeze([
  { keywords: ['file', 'doc'], label: 'Open File', value: 'open-file' },
  { disabled: true, label: 'Delete File', value: 'delete-file' },
  { textValue: 'Publish draft', value: 'publish' },
]);

const identifiedCommandItems: readonly CommandItem[] = Object.freeze([
  { id: 'command-item-0', label: 'Open dashboard', value: 'dashboard' },
  { id: 'command-item-1', label: 'Invite teammate', value: 'invite' },
  { disabled: true, id: 'command-item-2', label: 'Delete project', value: 'delete' },
]);

describe('headless-ui command primitive', () => {
  it('builds dialog trigger/content/close attributes for native command palette wiring', () => {
    expect(commandRootAttributes({ id: 'palette-root', inputValue: '', open: true })).toEqual({
      'data-placeholder': '',
      'data-state': 'open',
      id: 'palette-root',
    });
    expect(commandTriggerAttributes({ contentId: 'palette', open: true })).toEqual({
      'aria-controls': 'palette',
      'aria-expanded': 'true',
      'aria-haspopup': 'dialog',
      command: 'show-modal',
      commandfor: 'palette',
      'data-placeholder': '',
      'data-state': 'open',
      disabled: false,
      type: 'button',
    });
    expect(commandTriggerAttributes({ contentId: 'palette', disabled: true })).toEqual({
      'aria-expanded': 'false',
      'aria-haspopup': 'dialog',
      'data-disabled': '',
      'data-placeholder': '',
      'data-state': 'closed',
      disabled: true,
      type: 'button',
    });
    expect(
      commandDialogAttributes({
        contentId: 'palette',
        descriptionId: 'palette-description',
        open: true,
        titleId: 'palette-title',
      }),
    ).toEqual({
      'aria-describedby': 'palette-description',
      'aria-labelledby': 'palette-title',
      'aria-modal': 'true',
      'data-placeholder': '',
      'data-state': 'open',
      id: 'palette',
      open: true,
    });
    expect(commandCloseAttributes({ contentId: 'palette', open: true })).toEqual({
      command: 'request-close',
      commandfor: 'palette',
      'data-placeholder': '',
      'data-state': 'open',
      disabled: false,
      type: 'button',
    });
  });

  it('builds combobox-style input, listbox, item, and empty attributes', () => {
    const state = {
      highlightedValue: 'publish',
      inputValue: 'pub',
      items: commandItems,
      open: true,
      value: 'open-file',
    };

    expect(
      commandInputAttributes({
        ...state,
        autocomplete: 'off',
        descriptionId: 'palette-help',
        form: 'palette-form',
        id: 'palette-input',
        invalid: true,
        labelledBy: 'palette-title',
        listboxId: 'palette-list',
        name: 'palette-query',
        placeholder: 'Type a command',
        required: true,
      }),
    ).toEqual({
      'aria-activedescendant': 'palette-list-item-0',
      'aria-autocomplete': 'list',
      'aria-controls': 'palette-list',
      'aria-describedby': 'palette-help',
      'aria-expanded': 'true',
      'aria-invalid': 'true',
      'aria-labelledby': 'palette-title',
      autocomplete: 'off',
      'data-invalid': '',
      'data-required': '',
      'data-state': 'open',
      disabled: false,
      form: 'palette-form',
      id: 'palette-input',
      name: 'palette-query',
      placeholder: 'Type a command',
      required: true,
      role: 'combobox',
      type: 'text',
      value: 'pub',
    });
    expect(commandListboxAttributes({ ...state, id: 'palette-list' })).toEqual({
      'data-state': 'open',
      id: 'palette-list',
      role: 'listbox',
    });
    expect(commandListboxAttributes({ id: 'palette-list' })).toEqual({
      'data-placeholder': '',
      'data-state': 'closed',
      hidden: true,
      id: 'palette-list',
      role: 'listbox',
    });
    expect(commandItemAttributes({ ...state, id: 'publish-item', itemValue: 'publish' })).toEqual({
      'aria-selected': 'true',
      'data-highlighted': '',
      'data-state': 'active',
      id: 'publish-item',
      role: 'option',
      tabIndex: 0,
      value: 'publish',
    });
    expect(commandItemAttributes({ ...state, itemValue: 'delete-file' })).toEqual({
      'aria-disabled': 'true',
      'aria-selected': 'false',
      'data-disabled': '',
      'data-state': 'inactive',
      role: 'option',
      tabIndex: -1,
      value: 'delete-file',
    });
    expect(commandItemAttributes({ ...state, itemValue: 'open-file' })).toEqual({
      'aria-selected': 'false',
      'data-selected': '',
      'data-state': 'inactive',
      role: 'option',
      tabIndex: -1,
      value: 'open-file',
    });
    expect(commandEmptyAttributes({ items: commandItems, inputValue: 'missing' })).toEqual({
      'data-empty': '',
    });
    expect(commandEmptyAttributes({ items: commandItems, inputValue: 'open' })).toEqual({
      'data-empty': '',
      hidden: true,
    });
  });

  it('keeps aria-activedescendant aligned to stable item ids after filtering', () => {
    const filteredState = {
      highlightedValue: 'invite',
      inputValue: 'invite',
      items: identifiedCommandItems,
      listboxId: 'command-list',
      open: true,
    };

    expect(commandFilteredItems(filteredState).map(({ value }) => value)).toEqual(['invite']);
    expect(
      commandInputAttributes({
        ...filteredState,
        id: 'command-input',
      }),
    ).toMatchObject({
      'aria-activedescendant': 'command-item-1',
      'aria-controls': 'command-list',
    });
    expect(
      commandItemAttributes({
        ...filteredState,
        itemValue: 'invite',
      }),
    ).toMatchObject({
      'aria-selected': 'true',
      id: 'command-item-1',
      value: 'invite',
    });
  });

  it('filters items and resolves selected value text from labels, text values, or raw values', () => {
    expect(
      commandFilteredItems({ items: commandItems, inputValue: 'doc' }).map(({ value }) => value),
    ).toEqual(['open-file']);
    expect(
      commandFilteredItems({ items: commandItems, inputValue: 'draft' }).map(({ value }) => value),
    ).toEqual(['publish']);
    expect(commandFilteredItems({ items: commandItems, inputValue: '' })).toBe(commandItems);
    expect(commandValueText({ items: commandItems, value: 'open-file' })).toBe('Open File');
    expect(commandValueText({ items: commandItems, value: 'publish' })).toBe('Publish draft');
    expect(commandValueText({ value: 'custom-command' })).toBe('custom-command');
  });

  it('dispatches cancelable open, input, and value changes before committing state', () => {
    const seen: string[] = [];
    const openResult = setCommandOpen({ open: false }, true, 'programmatic', {
      onOpenChange(detail) {
        seen.push(`open:${detail.reason}:${detail.value}`);
      },
    });
    const inputResult = setCommandInputValue({ inputValue: '' }, 'open', 'programmatic', {
      onInputChange(detail) {
        seen.push(`input:${detail.reason}:${detail.value}`);
      },
    });
    const valueResult = setCommandValue({}, 'open-file', 'programmatic', {
      onValueChange(detail) {
        seen.push(`value:${detail.reason}:${detail.value}`);
      },
    });

    expect(seen).toEqual([
      'open:programmatic:true',
      'input:programmatic:open',
      'value:programmatic:open-file',
    ]);
    expect(openResult).toMatchObject({ changed: true, open: true });
    expect(inputResult).toMatchObject({ changed: true, inputValue: 'open' });
    expect(valueResult).toMatchObject({ changed: true, value: 'open-file' });
  });

  it('keeps previous state when change details are prevented or items are disabled', () => {
    expect(
      setCommandInputValue({ inputValue: 'open' }, 'delete', 'input', {
        onInputChange(detail) {
          detail.preventDefault();
        },
      }),
    ).toMatchObject({ changed: false, inputValue: 'open' });
    expect(
      setCommandValue({ items: commandItems, value: 'open-file' }, 'delete-file', 'item-click'),
    ).toEqual({ changed: false, value: 'open-file' });
    expect(toggleCommand({ disabled: true, open: false }, 'trigger-click')).toEqual({
      changed: false,
      open: false,
    });
  });

  it('selects an item by changing value then closing the dialog', () => {
    const seen: string[] = [];
    const result = selectCommandItem({ items: commandItems, open: true }, 'publish', 'item-click', {
      onOpenChange(detail) {
        seen.push(`open:${detail.reason}:${detail.value}`);
      },
      onValueChange(detail) {
        seen.push(`value:${detail.reason}:${detail.value}`);
      },
    });

    expect(result.selected).toBe(true);
    expect(result.value).toMatchObject({ changed: true, value: 'publish' });
    expect(result.open).toMatchObject({ changed: true, open: false });
    expect(seen).toEqual(['value:item-click:publish', 'open:item-select:false']);
  });

  it('keeps previous value when item selection cannot close the command dialog', () => {
    const seen: string[] = [];
    const result = selectCommandItem(
      { items: commandItems, open: true, value: 'open-file' },
      'publish',
      'item-click',
      {
        onOpenChange(detail) {
          seen.push(`open:${detail.reason}:${detail.value}`);
          detail.preventDefault();
        },
        onValueChange(detail) {
          seen.push(`value:${detail.reason}:${detail.value}`);
        },
      },
    );

    expect(result.selected).toBe(false);
    expect(result.value).toMatchObject({
      changed: false,
      detail: expect.objectContaining({ reason: 'item-click', value: 'publish' }),
      value: 'open-file',
    });
    expect(result.open).toMatchObject({
      changed: false,
      detail: expect.objectContaining({ defaultPrevented: true, reason: 'item-select' }),
      open: true,
    });
    expect(seen).toEqual(['value:item-click:publish', 'open:item-select:false']);
  });

  it('moves over filtered enabled items with shared keyboard navigation', () => {
    expect(commandMove({ items: commandItems }, 'ArrowDown')).toEqual({
      highlightedIndex: 0,
      highlightedValue: 'open-file',
    });
    expect(
      commandMove(
        { highlightedValue: 'open-file', inputValue: 'file', items: commandItems },
        'End',
      ),
    ).toEqual({
      highlightedIndex: 0,
      highlightedValue: 'open-file',
    });
    expect(
      commandMove({ highlightedValue: 'open-file', items: commandItems }, 'ArrowDown'),
    ).toEqual({
      highlightedIndex: 2,
      highlightedValue: 'publish',
    });
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const event = new Event('click', { cancelable: true });
    event.preventDefault();

    expect(
      commandTriggerClick(
        event,
        { open: false },
        {
          onOpenChange() {
            throw new Error('trigger should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();

    const inputEvent = commandInputEvent('open');
    inputEvent.preventDefault();
    expect(
      commandInput(
        inputEvent,
        { inputValue: '' },
        {
          onInputChange() {
            throw new Error('input should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();
  });

  it('uses handler reasons and prevents native behavior when disabled or canceled', () => {
    const inputEvent = commandInputEvent('publish');
    const inputResult = commandInput(inputEvent, { inputValue: '' });
    expect(inputResult).toMatchObject({
      changed: true,
      detail: expect.objectContaining({ reason: 'input', value: 'publish' }),
      inputValue: 'publish',
    });

    const delegatedInputEvent = commandInputEvent('target value', 'current target value');
    const delegatedInputResult = commandInput(delegatedInputEvent, { inputValue: '' });
    expect(delegatedInputResult).toMatchObject({
      changed: true,
      detail: expect.objectContaining({ reason: 'input', value: 'target value' }),
      inputValue: 'target value',
    });

    const disabledInputEvent = commandInputEvent('delete');
    const disabledInputResult = commandInput(disabledInputEvent, {
      disabled: true,
      inputValue: 'open',
    });
    expect(disabledInputResult).toEqual({ changed: false, inputValue: 'open' });
    expect(disabledInputEvent.currentTarget.value).toBe('open');
    expect(disabledInputEvent.defaultPrevented).toBe(true);

    const canceledInputEvent = commandInputEvent('close');
    const canceledInputResult = commandInput(
      canceledInputEvent,
      { inputValue: 'open' },
      {
        onInputChange(detail) {
          detail.preventDefault();
        },
      },
    );
    expect(canceledInputResult).toMatchObject({
      changed: false,
      detail: expect.objectContaining({ defaultPrevented: true }),
      inputValue: 'open',
    });
    expect(canceledInputEvent.currentTarget.value).toBe('open');
    expect(canceledInputEvent.defaultPrevented).toBe(true);

    const canceledItemEvent = new Event('click', { cancelable: true });
    const canceledItemResult = commandItemClick(
      canceledItemEvent,
      { itemValue: 'publish', open: true },
      {
        onValueChange(detail) {
          detail.preventDefault();
        },
      },
    );
    expect(canceledItemResult?.selected).toBe(false);
    expect(canceledItemEvent.defaultPrevented).toBe(true);

    const canceledCloseEvent = commandKeyEvent('Enter');
    const canceledCloseResult = commandKeyDown(
      canceledCloseEvent,
      { highlightedValue: 'publish', items: commandItems, open: true, value: 'open-file' },
      {
        onOpenChange(detail) {
          detail.preventDefault();
        },
      },
    );
    expect(canceledCloseResult).toMatchObject({
      selected: false,
      value: expect.objectContaining({ changed: false, value: 'open-file' }),
    });
    expect(canceledCloseEvent.defaultPrevented).toBe(true);

    const canceledValueEvent = commandKeyEvent('Enter');
    const canceledValueResult = commandKeyDown(
      canceledValueEvent,
      { highlightedValue: 'publish', items: commandItems, open: true, value: 'open-file' },
      {
        onValueChange(detail) {
          detail.preventDefault();
        },
      },
    );
    expect(canceledValueResult).toMatchObject({
      selected: false,
      value: expect.objectContaining({ changed: false, value: 'open-file' }),
    });
    expect(canceledValueEvent.defaultPrevented).toBe(true);

    const canceledEscapeEvent = commandKeyEvent('Escape');
    const canceledEscapeResult = commandKeyDown(
      canceledEscapeEvent,
      { open: true },
      {
        onOpenChange(detail) {
          detail.preventDefault();
        },
      },
    );
    expect(canceledEscapeResult).toMatchObject({
      changed: false,
      detail: expect.objectContaining({ defaultPrevented: true, reason: 'escape-key' }),
      open: true,
    });
    expect(canceledEscapeEvent.defaultPrevented).toBe(true);

    const enterEvent = commandKeyEvent('Enter');
    const enterResult = commandKeyDown(enterEvent, {
      highlightedValue: 'publish',
      items: commandItems,
      open: true,
    });
    expect(enterResult).toMatchObject({
      selected: true,
      value: expect.objectContaining({
        changed: true,
        detail: expect.objectContaining({ reason: 'enter-key', value: 'publish' }),
      }),
    });
    expect(enterEvent.defaultPrevented).toBe(true);

    const escapeEvent = commandKeyEvent('Escape');
    expect(commandKeyDown(escapeEvent, { open: true })).toMatchObject({
      changed: true,
      detail: expect.objectContaining({ reason: 'escape-key', value: false }),
      open: false,
    });
    expect(escapeEvent.defaultPrevented).toBe(true);
  });

  it('syncs native cancel and beforetoggle transitions', () => {
    const reasons: string[] = [];
    const cancelResult = commandCancel(
      new Event('cancel', { cancelable: true }),
      { open: true },
      {
        onOpenChange(detail) {
          reasons.push(`${detail.reason}:${detail.value}`);
        },
      },
    );
    const beforeToggleResult = commandBeforeToggle(
      beforeToggleEvent('open'),
      { open: false },
      {
        onOpenChange(detail) {
          reasons.push(`${detail.reason}:${detail.value}`);
        },
      },
    );

    expect(cancelResult).toMatchObject({ changed: true, open: false });
    expect(beforeToggleResult).toMatchObject({ changed: true, open: true });
    expect(reasons).toEqual(['cancel-event:false', 'native-beforetoggle:true']);
    expect(commandBeforeToggle(beforeToggleEvent(undefined), { open: true })).toBeUndefined();
  });

  it('returns frozen attribute records and exposes item helpers', () => {
    expect(Object.isFrozen(commandRootAttributes())).toBe(true);
    expect(Object.isFrozen(commandInputAttributes())).toBe(true);
    expect(Object.isFrozen(commandItemAttributes({ itemValue: 'open-file' }))).toBe(true);
    expect(commandItemSelected({ itemValue: 'open-file', value: 'open-file' })).toBe(true);
    expect(commandItemHighlighted({ highlightedValue: 'open-file', itemValue: 'open-file' })).toBe(
      true,
    );
  });

  it('is exported through the package root and primitives barrel', () => {
    expect(exportedCommandBeforeToggle).toBe(commandBeforeToggle);
    expect(exportedCommandCancel).toBe(commandCancel);
    expect(exportedCommandCloseAttributes).toBe(commandCloseAttributes);
    expect(exportedCommandCloseClick).toBe(commandCloseClick);
    expect(exportedCommandDialogAttributes).toBe(commandDialogAttributes);
    expect(exportedCommandEmptyAttributes).toBe(commandEmptyAttributes);
    expect(exportedCommandFilteredItems).toBe(commandFilteredItems);
    expect(exportedCommandInput).toBe(commandInput);
    expect(exportedCommandInputAttributes).toBe(commandInputAttributes);
    expect(exportedCommandItemAttributes).toBe(commandItemAttributes);
    expect(exportedCommandItemClick).toBe(commandItemClick);
    expect(exportedCommandItemHighlighted).toBe(commandItemHighlighted);
    expect(exportedCommandItemSelected).toBe(commandItemSelected);
    expect(exportedCommandKeyDown).toBe(commandKeyDown);
    expect(exportedCommandListboxAttributes).toBe(commandListboxAttributes);
    expect(exportedCommandMove).toBe(commandMove);
    expect(exportedCommandRootAttributes).toBe(commandRootAttributes);
    expect(exportedCommandTriggerAttributes).toBe(commandTriggerAttributes);
    expect(exportedCommandTriggerClick).toBe(commandTriggerClick);
    expect(exportedCommandValueText).toBe(commandValueText);
    expect(exportedSelectCommandItem).toBe(selectCommandItem);
    expect(exportedSetCommandInputValue).toBe(setCommandInputValue);
    expect(exportedSetCommandOpen).toBe(setCommandOpen);
    expect(exportedSetCommandValue).toBe(setCommandValue);
    expect(exportedToggleCommand).toBe(toggleCommand);
    expect(primitiveCommandRootAttributes).toBe(commandRootAttributes);
  });
});

function commandInputEvent(
  value: string,
  currentTargetValue?: string,
): Event & {
  readonly currentTarget: EventTarget & { value?: string };
  readonly target: EventTarget & { value?: string };
} {
  const event = new Event('input', { cancelable: true }) as Event & {
    currentTarget: EventTarget & { value?: string };
    target: EventTarget & { value?: string };
  };
  const target = { value };
  Object.defineProperty(event, 'currentTarget', {
    value: currentTargetValue === undefined ? target : { value: currentTargetValue },
  });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

function commandKeyEvent(key: string): Event & { readonly key: string } {
  const event = new Event('keydown', { cancelable: true }) as Event & { key: string };
  Object.defineProperty(event, 'key', { value: key });
  return event;
}

function beforeToggleEvent(
  newState: 'closed' | 'open' | undefined,
): Event & Readonly<{ newState?: 'closed' | 'open' }> {
  return Object.assign(
    new Event('beforetoggle', { cancelable: true }),
    newState === undefined ? {} : { newState },
  );
}
