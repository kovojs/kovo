/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  cn,
  defineVariants,
  dropdownMenuContentAttributes,
  dropdownMenuGroupAttributes,
  dropdownMenuItemAttributes,
  dropdownMenuRootAttributes,
  dropdownMenuSeparatorAttributes,
  dropdownMenuTriggerAttributes,
  type ClassValue,
  type DropdownMenuItem as HeadlessDropdownMenuItem,
} from '@kovojs/headless-ui';

export interface DropdownMenuStateProps {
  disabled?: boolean;
  highlightedValue?: string;
  items?: readonly HeadlessDropdownMenuItem[];
  open?: boolean;
}

export interface DropdownMenuProps extends DropdownMenuStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface DropdownMenuTriggerProps extends DropdownMenuStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
  id?: string;
  labelledBy?: string;
}

export interface DropdownMenuContentProps extends DropdownMenuStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  labelledBy?: string;
}

export interface DropdownMenuItemProps extends DropdownMenuStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

export interface DropdownMenuGroupProps extends DropdownMenuStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  labelledBy?: string;
}

export interface DropdownMenuSeparatorProps {
  class?: ClassValue;
  id?: string;
}

export const dropdownMenuClassNames = defineVariants({
  base: 'relative inline-block text-sm text-neutral-950 data-[disabled]:opacity-50',
  variants: {},
});

export const dropdownMenuTriggerClassNames = defineVariants({
  base: 'inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:bg-neutral-100',
  variants: {},
});

export const dropdownMenuContentClassNames = defineVariants({
  base: 'min-w-40 rounded-md border border-neutral-200 bg-white p-1 text-sm text-neutral-950 shadow-md outline-none data-[state=closed]:hidden',
  variants: {},
});

export const dropdownMenuItemClassNames = defineVariants({
  base: 'flex w-full items-center rounded px-2 py-1.5 text-left text-sm text-neutral-700 outline-none data-[highlighted]:bg-neutral-100 data-[highlighted]:text-neutral-950 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  variants: {},
});

export const dropdownMenuGroupClassNames = defineVariants({
  base: 'grid gap-1 px-1 py-1 data-[disabled]:opacity-50',
  variants: {},
});

export const dropdownMenuSeparatorClassNames = defineVariants({
  base: 'my-1 h-px bg-neutral-200',
  variants: {},
});

export const dropdownMenuClasses = dropdownMenuClassNames.classes;
export const dropdownMenuTriggerClasses = dropdownMenuTriggerClassNames.classes;
export const dropdownMenuContentClasses = dropdownMenuContentClassNames.classes;
export const dropdownMenuItemClasses = dropdownMenuItemClassNames.classes;
export const dropdownMenuGroupClasses = dropdownMenuGroupClassNames.classes;
export const dropdownMenuSeparatorClasses = dropdownMenuSeparatorClassNames.classes;

export const DropdownMenu = component('dropdown-menu', {
  render(props: DropdownMenuProps) {
    const attrs = dropdownMenuRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.open === undefined ? {} : { open: props.open }),
    });

    return (
      <div
        class={cn(dropdownMenuClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

export const DropdownMenuTrigger = component('dropdown-menu-trigger', {
  render(props: DropdownMenuTriggerProps) {
    const attrs = dropdownMenuTriggerAttributes({
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.open === undefined ? {} : { open: props.open }),
    });

    return (
      <button
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        aria-haspopup={attrs['aria-haspopup']}
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(dropdownMenuTriggerClassNames(), props.class)}
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

export const DropdownMenuContent = component('dropdown-menu-content', {
  render(props: DropdownMenuContentProps) {
    const attrs = dropdownMenuContentAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.open === undefined ? {} : { open: props.open }),
    });

    return (
      <div
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(dropdownMenuContentClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
        role={attrs.role}
        tabIndex={attrs.tabIndex}
      >
        {props.children}
      </div>
    );
  },
});

export const DropdownMenuItem = component('dropdown-menu-item', {
  render(props: DropdownMenuItemProps) {
    const attrs = dropdownMenuItemAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.itemLabel === undefined ? {} : { itemLabel: props.itemLabel }),
      ...(props.items === undefined ? {} : { items: props.items }),
      itemValue: props.itemValue,
      ...(props.open === undefined ? {} : { open: props.open }),
    });

    return (
      <button
        aria-disabled={attrs['aria-disabled']}
        class={cn(dropdownMenuItemClassNames(), props.class)}
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
        {props.children ?? props.itemLabel ?? props.itemValue}
      </button>
    );
  },
});

export const DropdownMenuGroup = component('dropdown-menu-group', {
  render(props: DropdownMenuGroupProps) {
    const attrs = dropdownMenuGroupAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.open === undefined ? {} : { open: props.open }),
    });

    return (
      <div
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(dropdownMenuGroupClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={attrs.id}
        role={attrs.role}
      >
        {props.children}
      </div>
    );
  },
});

export const DropdownMenuSeparator = component('dropdown-menu-separator', {
  render(props: DropdownMenuSeparatorProps) {
    const attrs = dropdownMenuSeparatorAttributes(props.id === undefined ? {} : { id: props.id });

    return (
      <div
        class={cn(dropdownMenuSeparatorClassNames(), props.class)}
        id={attrs.id}
        role={attrs.role}
      />
    );
  },
});
