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
} from '@kovojs/headless-ui';
import { escapeHtml } from '@kovojs/server';
import * as style from '@kovojs/style';

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

export interface CommandProps extends CommandStateProps {
  children?: string;
  id?: string;
  styles?: CommandStyleOverrides;
}

export interface CommandTriggerProps extends CommandStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  labelledBy?: string;
  styles?: CommandStyleOverrides;
}

export interface CommandDialogProps extends CommandStateProps {
  children?: string;
  contentId?: string;
  descriptionId?: string;
  styles?: CommandStyleOverrides;
  titleId?: string;
}

export interface CommandCloseProps extends CommandStateProps {
  children?: string;
  contentId?: string;
  styles?: CommandStyleOverrides;
}

export interface CommandInputProps extends CommandStateProps {
  autocomplete?: string;
  descriptionId?: string;
  id?: string;
  labelledBy?: string;
  listboxId?: string;
  styles?: CommandStyleOverrides;
}

export interface CommandListboxProps extends CommandStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: CommandStyleOverrides;
}

export interface CommandItemProps extends CommandStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
  styles?: CommandStyleOverrides;
}

export interface CommandEmptyProps extends CommandStateProps {
  children?: string;
  id?: string;
  styles?: CommandStyleOverrides;
}

export interface CommandValueProps extends CommandStateProps {
  id?: string;
  styles?: CommandStyleOverrides;
}

export const commandStyles = style.create(
  {
    close: {
      alignItems: 'center',
      backgroundColor: '#ffffff',
      borderColor: '#d4d4d4',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      color: '#0a0a0a',
      display: 'inline-flex',
      fontSize: 14,
      fontWeight: 500,
      height: 32,
      justifyContent: 'center',
      marginTop: 12,
      paddingInline: 12,
      transitionProperty: 'background-color, color',
      ':disabled': {
        cursor: 'not-allowed',
        opacity: 0.5,
      },
      ':focus-visible': {
        outlineColor: '#0a0a0a',
        outlineOffset: 2,
        outlineStyle: 'solid',
        outlineWidth: 2,
      },
      ':hover': {
        backgroundColor: '#f5f5f5',
      },
    },
    dialog: {
      backgroundColor: '#ffffff',
      borderColor: '#e5e5e5',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
      color: '#0a0a0a',
      maxWidth: 512,
      padding: 16,
      width: '100%',
      '::backdrop': {
        backgroundColor: 'rgb(0 0 0 / 0.2)',
      },
      '[data-state=closed]': {
        display: 'none',
      },
    },
    empty: {
      color: '#737373',
      fontSize: 14,
      paddingBlock: 16,
      paddingInline: 8,
      textAlign: 'center',
    },
    input: {
      backgroundColor: '#ffffff',
      borderColor: '#d4d4d4',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      color: '#0a0a0a',
      fontSize: 14,
      height: 36,
      outlineStyle: 'none',
      paddingInline: 12,
      transitionProperty: 'background-color, border-color, box-shadow',
      width: '100%',
      '[data-placeholder]': {
        color: '#737373',
      },
      ':disabled': {
        backgroundColor: '#f5f5f5',
        color: '#737373',
        cursor: 'not-allowed',
      },
      ':focus-visible': {
        boxShadow: '0 0 0 2px #0a0a0a',
      },
    },
    item: {
      alignItems: 'center',
      borderRadius: 4,
      color: '#404040',
      display: 'flex',
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
        backgroundColor: '#f5f5f5',
        color: '#0a0a0a',
      },
      '[data-state=checked]': {
        fontWeight: 500,
      },
    },
    listbox: {
      backgroundColor: '#ffffff',
      borderColor: '#e5e5e5',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      marginTop: 12,
      maxHeight: 256,
      overflow: 'auto',
      padding: 4,
      '[data-state=closed]': {
        display: 'none',
      },
    },
    root: {
      color: '#0a0a0a',
      display: 'grid',
      fontSize: 14,
      rowGap: 8,
      '[data-disabled]': {
        opacity: 0.5,
      },
    },
    trigger: {
      alignItems: 'center',
      backgroundColor: '#ffffff',
      borderColor: '#d4d4d4',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
      color: '#0a0a0a',
      display: 'inline-flex',
      fontSize: 14,
      fontWeight: 500,
      height: 36,
      justifyContent: 'center',
      paddingInline: 12,
      transitionProperty: 'background-color, color',
      '[data-state=open]': {
        backgroundColor: '#f5f5f5',
      },
      ':disabled': {
        cursor: 'not-allowed',
        opacity: 0.5,
      },
      ':focus-visible': {
        outlineColor: '#0a0a0a',
        outlineOffset: 2,
        outlineStyle: 'solid',
        outlineWidth: 2,
      },
      ':hover': {
        backgroundColor: '#f5f5f5',
      },
    },
    value: {
      color: '#404040',
      fontSize: 14,
    },
  },
  { namespace: 'command', source: 'command.tsx' },
);

export const commandClasses = [style.attrs(commandStyles.root).class ?? ''] as const;
export const commandTriggerClasses = [style.attrs(commandStyles.trigger).class ?? ''] as const;
export const commandDialogClasses = [style.attrs(commandStyles.dialog).class ?? ''] as const;
export const commandInputClasses = [style.attrs(commandStyles.input).class ?? ''] as const;
export const commandListboxClasses = [style.attrs(commandStyles.listbox).class ?? ''] as const;
export const commandItemClasses = [style.attrs(commandStyles.item).class ?? ''] as const;
export const commandCloseClasses = [style.attrs(commandStyles.close).class ?? ''] as const;
export const commandEmptyClasses = [style.attrs(commandStyles.empty).class ?? ''] as const;
export const commandValueClasses = [style.attrs(commandStyles.value).class ?? ''] as const;

export const Command = component({
  render(props: CommandProps) {
    const attrs = commandRootAttributes(toCommandState(props));
    const styleAttrs = style.attrs(commandStyles.root, props.styles?.root);

    return (
      <div
        {...styleAttrs}
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

    return (
      <input
        {...styleAttrs}
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
    );
  },
});

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
        data-empty={attrs['data-empty']}
        hidden={attrs.hidden}
        id={attrs.id}
      >
        {props.children ?? 'No results'}
      </div>
    );
  },
});

export const CommandValue = component({
  render(props: CommandValueProps) {
    const styleAttrs = style.attrs(commandStyles.value, props.styles?.value);

    return (
      <span {...styleAttrs} id={props.id}>
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
