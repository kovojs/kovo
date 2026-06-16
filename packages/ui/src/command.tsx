/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  cn,
  commandCloseAttributes,
  commandDialogAttributes,
  commandEmptyAttributes,
  commandInputAttributes,
  commandItemAttributes,
  commandListboxAttributes,
  commandRootAttributes,
  commandTriggerAttributes,
  commandValueText,
  defineVariants,
  type ClassValue,
  type CommandItem as HeadlessCommandItem,
} from '@jiso/headless-ui';
import { escapeHtml } from '@jiso/server';

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
  class?: ClassValue;
  id?: string;
}

export interface CommandTriggerProps extends CommandStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
  id?: string;
  labelledBy?: string;
}

export interface CommandDialogProps extends CommandStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
  descriptionId?: string;
  titleId?: string;
}

export interface CommandCloseProps extends CommandStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
}

export interface CommandInputProps extends CommandStateProps {
  autocomplete?: string;
  class?: ClassValue;
  descriptionId?: string;
  id?: string;
  labelledBy?: string;
  listboxId?: string;
}

export interface CommandListboxProps extends CommandStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  labelledBy?: string;
}

export interface CommandItemProps extends CommandStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

export interface CommandEmptyProps extends CommandStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface CommandValueProps extends CommandStateProps {
  class?: ClassValue;
  id?: string;
}

export const commandClassNames = defineVariants({
  base: 'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50',
  variants: {},
});

export const commandTriggerClassNames = defineVariants({
  base: 'inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:bg-neutral-100',
  variants: {},
});

export const commandDialogClassNames = defineVariants({
  base: 'w-full max-w-lg rounded-md border border-neutral-200 bg-white p-4 text-neutral-950 shadow-lg backdrop:bg-black/20 data-[state=closed]:hidden',
  variants: {},
});

export const commandInputClassNames = defineVariants({
  base: 'h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 data-[placeholder]:text-neutral-500',
  variants: {},
});

export const commandListboxClassNames = defineVariants({
  base: 'mt-3 max-h-64 overflow-auto rounded-md border border-neutral-200 bg-white p-1 data-[state=closed]:hidden',
  variants: {},
});

export const commandItemClassNames = defineVariants({
  base: 'flex w-full items-center rounded px-2 py-1.5 text-left text-sm text-neutral-700 outline-none data-[highlighted]:bg-neutral-100 data-[highlighted]:text-neutral-950 data-[state=checked]:font-medium data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  variants: {},
});

export const commandCloseClassNames = defineVariants({
  base: 'mt-3 inline-flex h-8 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50',
  variants: {},
});

export const commandEmptyClassNames = defineVariants({
  base: 'px-2 py-4 text-center text-sm text-neutral-500',
  variants: {},
});

export const commandValueClassNames = defineVariants({
  base: 'text-sm text-neutral-700',
  variants: {},
});

export const commandClasses = commandClassNames.classes;
export const commandTriggerClasses = commandTriggerClassNames.classes;
export const commandDialogClasses = commandDialogClassNames.classes;
export const commandInputClasses = commandInputClassNames.classes;
export const commandListboxClasses = commandListboxClassNames.classes;
export const commandItemClasses = commandItemClassNames.classes;
export const commandCloseClasses = commandCloseClassNames.classes;
export const commandEmptyClasses = commandEmptyClassNames.classes;
export const commandValueClasses = commandValueClassNames.classes;

export const Command = component('command', {
  render(props: CommandProps) {
    const attrs = commandRootAttributes(toCommandState(props));

    return (
      <div
        class={cn(commandClassNames(), props.class)}
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

export const CommandTrigger = component('command-trigger', {
  render(props: CommandTriggerProps) {
    const attrs = commandTriggerAttributes({
      ...toCommandState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
    });

    return (
      <button
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        aria-haspopup={attrs['aria-haspopup']}
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(commandTriggerClassNames(), props.class)}
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

export const CommandDialog = component('command-dialog', {
  render(props: CommandDialogProps) {
    const attrs = commandDialogAttributes({
      ...toCommandState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.titleId === undefined ? {} : { titleId: props.titleId }),
    });

    return (
      <dialog
        aria-describedby={attrs['aria-describedby']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-modal={attrs['aria-modal']}
        class={cn(commandDialogClassNames(), props.class)}
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

export const CommandInput = component('command-input', {
  render(props: CommandInputProps) {
    const attrs = commandInputAttributes({
      ...(props.autocomplete === undefined ? {} : { autocomplete: props.autocomplete }),
      ...toCommandState(props),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.listboxId === undefined ? {} : { listboxId: props.listboxId }),
    });

    return (
      <input
        aria-activedescendant={attrs['aria-activedescendant']}
        aria-autocomplete={attrs['aria-autocomplete']}
        aria-controls={attrs['aria-controls']}
        aria-describedby={attrs['aria-describedby']}
        aria-expanded={attrs['aria-expanded']}
        aria-invalid={attrs['aria-invalid']}
        aria-labelledby={attrs['aria-labelledby']}
        autocomplete={attrs.autocomplete}
        class={cn(commandInputClassNames(), props.class)}
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

export const CommandListbox = component('command-listbox', {
  render(props: CommandListboxProps) {
    const attrs = commandListboxAttributes({
      ...toCommandState(props),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
    });

    return (
      <div
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(commandListboxClassNames(), props.class)}
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

export const CommandItem = component('command-item', {
  render(props: CommandItemProps) {
    const attrs = commandItemAttributes({
      ...toCommandState(props),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.itemLabel === undefined ? {} : { itemLabel: props.itemLabel }),
      itemValue: props.itemValue,
    });

    return (
      <button
        aria-disabled={attrs['aria-disabled']}
        aria-selected={attrs['aria-selected']}
        class={cn(commandItemClassNames(), props.class)}
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

export const CommandClose = component('command-close', {
  render(props: CommandCloseProps) {
    const attrs = commandCloseAttributes({
      ...toCommandState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });

    return (
      <button
        class={cn(commandCloseClassNames(), props.class)}
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

export const CommandEmpty = component('command-empty', {
  render(props: CommandEmptyProps) {
    const attrs = commandEmptyAttributes({
      ...toCommandState(props),
      ...(props.id === undefined ? {} : { id: props.id }),
    });

    return (
      <div
        class={cn(commandEmptyClassNames(), props.class)}
        data-empty={attrs['data-empty']}
        hidden={attrs.hidden}
        id={attrs.id}
      >
        {props.children ?? 'No results'}
      </div>
    );
  },
});

export const CommandValue = component('command-value', {
  render(props: CommandValueProps) {
    return (
      <span class={cn(commandValueClassNames(), props.class)} id={props.id}>
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
