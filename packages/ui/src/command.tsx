/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  commandCloseAttributes,
  commandDialogAttributes,
  commandEmptyAttributes,
  commandInputAttributes,
  commandItemAttributes,
  commandListboxAttributes,
  commandRootAttributes,
  commandTriggerAttributes,
  commandValueText,
  type CommandItem as HeadlessCommandItem,
} from '@kovojs/headless-ui/command';
import { Search } from '@kovojs/icons/search';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

/**
 * Style override slots accepted by the command components.
 *
 * @example
 * import type { CommandStyleOverrides } from "@kovojs/ui/command";
 * const styles: CommandStyleOverrides = {};
 */
export interface CommandStyleOverrides {
  close?: style.StyleInput;
  dialog?: style.StyleInput;
  empty?: style.StyleInput;
  input?: style.StyleInput;
  item?: style.StyleInput;
  listbox?: style.StyleInput;
  root?: style.StyleInput;
  trigger?: style.StyleInput;
  value?: style.StyleInput;
}

/**
 * Shared state props for the command component family.
 *
 * @example
 * import type { CommandStateProps } from "@kovojs/ui/command";
 * const state: CommandStateProps = {};
 */
export interface CommandStateProps {
  disabled?: boolean;
  form?: string;
  highlightedValue?: string;
  inputValue?: string;
  invalid?: boolean;
  items?: readonly HeadlessCommandItem[];
  name?: string;
  open?: boolean;
  placeholder?: string;
  required?: boolean;
  value?: string;
}

/**
 * Props for the command component.
 *
 * @example
 * import type { CommandProps } from "@kovojs/ui/command";
 * const props: CommandProps = { children: 'Content' };
 */
export interface CommandProps extends CommandStateProps {
  children?: string;
  id?: string;
  styles?: CommandStyleOverrides;
}

/**
 * Props for the command trigger component.
 *
 * @example
 * import type { CommandTriggerProps } from "@kovojs/ui/command";
 * const props: CommandTriggerProps = { children: 'Content' };
 */
export interface CommandTriggerProps extends CommandStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  labelledBy?: string;
  styles?: CommandStyleOverrides;
}

/**
 * Props for the command dialog component.
 *
 * @example
 * import type { CommandDialogProps } from "@kovojs/ui/command";
 * const props: CommandDialogProps = { children: 'Content' };
 */
export interface CommandDialogProps extends CommandStateProps {
  children?: string;
  contentId?: string;
  descriptionId?: string;
  styles?: CommandStyleOverrides;
  titleId?: string;
}

/**
 * Props for the command close component.
 *
 * @example
 * import type { CommandCloseProps } from "@kovojs/ui/command";
 * const props: CommandCloseProps = { children: 'Content' };
 */
export interface CommandCloseProps extends CommandStateProps {
  children?: string;
  contentId?: string;
  styles?: CommandStyleOverrides;
}

/**
 * Props for the command input component.
 *
 * @example
 * import type { CommandInputProps } from "@kovojs/ui/command";
 * const props: CommandInputProps = {};
 */
export interface CommandInputProps extends CommandStateProps {
  autocomplete?: string;
  descriptionId?: string;
  id?: string;
  labelledBy?: string;
  listboxId?: string;
  styles?: CommandStyleOverrides;
}

/**
 * Props for the command listbox component.
 *
 * @example
 * import type { CommandListboxProps } from "@kovojs/ui/command";
 * const props: CommandListboxProps = { children: 'Content' };
 */
export interface CommandListboxProps extends CommandStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: CommandStyleOverrides;
}

/**
 * Props for the command item component.
 *
 * @example
 * import type { CommandItemProps } from "@kovojs/ui/command";
 * const props: CommandItemProps = { itemValue: 'item', children: 'Content' };
 */
export interface CommandItemProps extends CommandStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
  styles?: CommandStyleOverrides;
}

/**
 * Props for the command empty component.
 *
 * @example
 * import type { CommandEmptyProps } from "@kovojs/ui/command";
 * const props: CommandEmptyProps = { children: 'Content' };
 */
export interface CommandEmptyProps extends CommandStateProps {
  children?: string;
  id?: string;
  styles?: CommandStyleOverrides;
}

/**
 * Props for the command value component.
 *
 * @example
 * import type { CommandValueProps } from "@kovojs/ui/command";
 * const props: CommandValueProps = {};
 */
export interface CommandValueProps extends CommandStateProps {
  id?: string;
  styles?: CommandStyleOverrides;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Style definitions used by the command components.
 *
 * @example
 * import { commandStyles } from "@kovojs/ui/command";
 * const styles = commandStyles;
 */
export const commandStyles = style.create({
  close: {
    alignItems: 'center',
    appearance: 'none',
    alignSelf: 'flex-end',
    backgroundColor: 'transparent',
    borderRadius: uiTheme.radius.sm,
    borderStyle: 'none',
    borderWidth: 0,
    color: uiTheme.color.foregroundMuted,
    display: 'inline-flex',
    font: 'inherit',
    fontSize: 12,
    height: 28,
    justifyContent: 'center',
    marginTop: 8,
    paddingInline: 8,
    transitionProperty: 'background-color, color',
    ':disabled': {
      cursor: 'not-allowed',
      opacity: 0.5,
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
    ':hover': {
      backgroundColor: uiTheme.color.backgroundSubtle,
      color: uiTheme.color.foreground,
    },
  },
  dialog: {
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.lg,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    color: uiTheme.color.foreground,
    maxWidth: 512,
    // Edge-to-edge: the input header + list reach the rounded shell so there is
    // no padding gutter around them (shadcn's command dialog framing).
    overflow: 'hidden',
    padding: 0,
    width: '100%',
    '::backdrop': {
      backgroundColor: 'rgb(0 0 0 / 0.2)',
    },
    '[data-state=closed]': {
      display: 'none',
    },
  },
  empty: {
    color: uiTheme.color.foregroundMuted,
    fontSize: 14,
    paddingBlock: 16,
    paddingInline: 8,
    textAlign: 'center',
  },
  // Header row: a leading search icon + the borderless input, with a bottom
  // divider separating the search from the list (shadcn cmdk framing).
  inputWrapper: {
    alignItems: 'center',
    borderBottomColor: uiTheme.color.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    columnGap: 8,
    display: 'flex',
    paddingInline: 12,
  },
  inputIcon: {
    color: uiTheme.color.foregroundMuted,
    flexShrink: 0,
    height: 16,
    width: 16,
  },
  input: {
    backgroundColor: 'transparent',
    borderStyle: 'none',
    borderWidth: 0,
    color: uiTheme.color.foreground,
    flexGrow: 1,
    fontSize: 14,
    height: 44,
    minWidth: 0,
    outlineStyle: 'none',
    width: '100%',
    '::placeholder': {
      color: uiTheme.color.foregroundMuted,
    },
    '[data-placeholder]': {
      color: uiTheme.color.foregroundMuted,
    },
    ':disabled': {
      color: uiTheme.color.foregroundMuted,
      cursor: 'not-allowed',
    },
  },
  heading: {
    color: uiTheme.color.foregroundMuted,
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: '0.04em',
    paddingBlock: 6,
    paddingInline: 8,
    textTransform: 'uppercase',
  },
  item: {
    alignItems: 'center',
    appearance: 'none',
    backgroundColor: 'transparent',
    borderRadius: uiTheme.radius.sm,
    borderStyle: 'none',
    borderWidth: 0,
    color: uiTheme.color.foreground,
    columnGap: 8,
    cursor: 'default',
    display: 'flex',
    font: 'inherit',
    fontSize: 14,
    outlineStyle: 'none',
    paddingBlock: 6,
    paddingInline: 8,
    textAlign: 'left',
    width: '100%',
    '[data-disabled]': {
      opacity: 0.5,
      pointerEvents: 'none',
    },
    '[data-highlighted]': {
      backgroundColor: uiTheme.color.backgroundSubtle,
      color: uiTheme.color.foreground,
    },
    '[data-state=checked]': {
      fontWeight: 500,
    },
    ':focus-visible': {
      backgroundColor: uiTheme.color.backgroundSubtle,
      color: uiTheme.color.foreground,
      outlineColor: uiTheme.color.accent,
      outlineOffset: -2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
    ':hover': {
      backgroundColor: uiTheme.color.backgroundSubtle,
      color: uiTheme.color.foreground,
    },
  },
  itemIcon: {
    color: uiTheme.color.foregroundMuted,
    flexShrink: 0,
    fontSize: 16,
    lineHeight: 1,
  },
  itemShortcut: {
    color: uiTheme.color.foregroundMuted,
    fontSize: 12,
    letterSpacing: '0.06em',
    marginLeft: 'auto',
  },
  // Flush inside the dialog: no border/shadow/top-margin (the dialog is the
  // surface), just a scrollable padded list.
  listbox: {
    backgroundColor: uiTheme.color.background,
    maxHeight: 300,
    overflow: 'auto',
    padding: 4,
    '[data-state=closed]': {
      display: 'none',
    },
    '[data-state=open]': {
      display: 'block',
    },
  },
  root: {
    color: uiTheme.color.foreground,
    display: 'grid',
    fontSize: 14,
    rowGap: 8,
    '[data-disabled]': {
      opacity: 0.5,
    },
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.borderStrong,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
    color: uiTheme.color.foreground,
    display: 'inline-flex',
    fontSize: 14,
    fontWeight: 500,
    height: 36,
    justifyContent: 'center',
    paddingInline: 12,
    transitionProperty: 'background-color, color',
    '[data-state=open]': {
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
    },
    ':disabled': {
      cursor: 'not-allowed',
      opacity: 0.5,
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
    ':hover': {
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
    },
  },
  value: {
    color: uiTheme.color.foregroundMuted,
    fontSize: 14,
  },
});

/**
 * Renders the styled command primitive.
 *
 * @example
 * import { Command } from "@kovojs/ui/command";
 * const component = Command;
 */
export const Command = component({
  render(props: CommandProps) {
    const attrs = commandRootAttributes(toCommandState(props));
    const styleAttrs = style.attrs(commandStyles.root, props.styles?.root);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        data-state={attrs['data-state']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

/**
 * Renders the styled command trigger primitive.
 *
 * @example
 * import { CommandTrigger } from "@kovojs/ui/command";
 * const component = CommandTrigger;
 */
export const CommandTrigger = component({
  render(props: CommandTriggerProps) {
    const attrs = commandTriggerAttributes({
      ...toCommandState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
    });
    const styleAttrs = style.attrs(commandStyles.trigger, props.styles?.trigger);

    return (
      <button
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        aria-haspopup={attrs['aria-haspopup']}
        aria-labelledby={attrs['aria-labelledby']}
        command={attrs.command}
        commandfor={attrs.commandfor}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        id={attrs.id}
        type={attrs.type}
      >
        {props.children}
      </button>
    );
  },
});

/**
 * Renders the styled command dialog primitive.
 *
 * @example
 * import { CommandDialog } from "@kovojs/ui/command";
 * const component = CommandDialog;
 */
export const CommandDialog = component({
  render(props: CommandDialogProps) {
    const attrs = commandDialogAttributes({
      ...toCommandState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.titleId === undefined ? {} : { titleId: props.titleId }),
    });
    const styleAttrs = style.attrs(commandStyles.dialog, props.styles?.dialog);

    return (
      <dialog
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-describedby={attrs['aria-describedby']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-modal={attrs['aria-modal']}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={attrs.id}
        open={attrs.open}
      >
        {props.children}
      </dialog>
    );
  },
});

/**
 * Renders the styled command input primitive.
 *
 * @example
 * import { CommandInput } from "@kovojs/ui/command";
 * const component = CommandInput;
 */
export const CommandInput = component({
  render(props: CommandInputProps) {
    const attrs = commandInputAttributes({
      ...(props.autocomplete === undefined ? {} : { autocomplete: props.autocomplete }),
      ...toCommandState(props),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.listboxId === undefined ? {} : { listboxId: props.listboxId }),
    });
    const styleAttrs = style.attrs(commandStyles.input, props.styles?.input);
    const wrapperAttrs = style.attrs(commandStyles.inputWrapper);

    return (
      <div {...wrapperAttrs}>
        <Search style={commandStyles.inputIcon} />
        <input
          {...styleAttrs}
          {...passThroughProps(props)}
          aria-activedescendant={attrs['aria-activedescendant']}
          aria-autocomplete={attrs['aria-autocomplete']}
          aria-controls={attrs['aria-controls']}
          aria-describedby={attrs['aria-describedby']}
          aria-expanded={attrs['aria-expanded']}
          aria-invalid={attrs['aria-invalid']}
          aria-labelledby={attrs['aria-labelledby']}
          autocomplete={attrs.autocomplete}
          data-disabled={attrs['data-disabled']}
          data-invalid={attrs['data-invalid']}
          data-required={attrs['data-required']}
          data-state={attrs['data-state']}
          disabled={attrs.disabled}
          form={attrs.form}
          id={attrs.id}
          name={attrs.name}
          placeholder={attrs.placeholder}
          required={attrs.required}
          role={attrs.role}
          type={attrs.type}
          value={attrs.value}
        />
      </div>
    );
  },
});

/**
 * Renders the styled command listbox primitive.
 *
 * @example
 * import { CommandListbox } from "@kovojs/ui/command";
 * const component = CommandListbox;
 */
export const CommandListbox = component({
  render(props: CommandListboxProps) {
    const attrs = commandListboxAttributes({
      ...toCommandState(props),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
    });
    const styleAttrs = style.attrs(commandStyles.listbox, props.styles?.listbox);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-labelledby={attrs['aria-labelledby']}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
        role={attrs.role}
      >
        {props.children}
      </div>
    );
  },
});

/**
 * Renders the styled command item primitive.
 *
 * @example
 * import { CommandItem } from "@kovojs/ui/command";
 * const component = CommandItem;
 */
export const CommandItem = component({
  render(props: CommandItemProps) {
    const attrs = commandItemAttributes({
      ...toCommandState(props),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.itemLabel === undefined ? {} : { itemLabel: props.itemLabel }),
      itemValue: props.itemValue,
    });
    const styleAttrs = style.attrs(commandStyles.item, props.styles?.item);

    return (
      <button
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-disabled={attrs['aria-disabled']}
        aria-selected={attrs['aria-selected']}
        data-disabled={attrs['data-disabled']}
        data-highlighted={attrs['data-highlighted']}
        data-state={attrs['data-state']}
        disabled={attrs['data-disabled'] === '' ? true : undefined}
        id={attrs.id}
        role={attrs.role}
        tabIndex={attrs.tabIndex}
        type="button"
        value={attrs.value}
      >
        {props.children ?? escapeHtml(props.itemLabel ?? props.itemValue ?? '')}
      </button>
    );
  },
});

/**
 * Renders the styled command close primitive.
 *
 * @example
 * import { CommandClose } from "@kovojs/ui/command";
 * const component = CommandClose;
 */
export const CommandClose = component({
  render(props: CommandCloseProps) {
    const attrs = commandCloseAttributes({
      ...toCommandState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });
    const styleAttrs = style.attrs(commandStyles.close, props.styles?.close);

    return (
      <button
        {...styleAttrs}
        {...passThroughProps(props)}
        command={attrs.command}
        commandfor={attrs.commandfor}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        type={attrs.type}
      >
        {props.children ?? 'Close'}
      </button>
    );
  },
});

/**
 * Renders the styled command empty primitive.
 *
 * @example
 * import { CommandEmpty } from "@kovojs/ui/command";
 * const component = CommandEmpty;
 */
export const CommandEmpty = component({
  render(props: CommandEmptyProps) {
    const attrs = commandEmptyAttributes({
      ...toCommandState(props),
      ...(props.id === undefined ? {} : { id: props.id }),
    });
    const styleAttrs = style.attrs(commandStyles.empty, props.styles?.empty);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        data-empty={attrs['data-empty']}
        hidden={attrs.hidden}
        id={attrs.id}
      >
        {props.children ?? 'No results'}
      </div>
    );
  },
});

/**
 * Renders the styled command value primitive.
 *
 * @example
 * import { CommandValue } from "@kovojs/ui/command";
 * const component = CommandValue;
 */
export const CommandValue = component({
  render(props: CommandValueProps) {
    const styleAttrs = style.attrs(commandStyles.value, props.styles?.value);

    return (
      <span {...styleAttrs} {...passThroughProps(props)} id={props.id}>
        {escapeHtml(commandValueText(props))}
      </span>
    );
  },
});

function toCommandState(props: CommandStateProps & { id?: string }) {
  return {
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    ...(props.form === undefined ? {} : { form: props.form }),
    ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
    ...(props.id === undefined ? {} : { id: props.id }),
    ...(props.inputValue === undefined ? {} : { inputValue: props.inputValue }),
    ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
    ...(props.items === undefined ? {} : { items: props.items }),
    ...(props.name === undefined ? {} : { name: props.name }),
    ...(props.open === undefined ? {} : { open: props.open }),
    ...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
    ...(props.required === undefined ? {} : { required: props.required }),
    ...(props.value === undefined ? {} : { value: props.value }),
  };
}
