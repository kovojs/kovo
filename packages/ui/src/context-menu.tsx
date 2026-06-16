/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  cn,
  contextMenuContentAttributes,
  contextMenuGroupAttributes,
  contextMenuItemAttributes,
  contextMenuRootAttributes,
  contextMenuSeparatorAttributes,
  contextMenuTriggerAttributes,
  defineVariants,
  type ClassValue,
  type ContextMenuItem as HeadlessContextMenuItem,
  type ContextMenuPoint,
} from '@kovojs/headless-ui';

export interface ContextMenuStateProps {
  disabled?: boolean;
  highlightedValue?: string;
  items?: readonly HeadlessContextMenuItem[];
  open?: boolean;
  point?: ContextMenuPoint;
}

export interface ContextMenuProps extends ContextMenuStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface ContextMenuTriggerProps extends ContextMenuStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
  id?: string;
  labelledBy?: string;
}

export interface ContextMenuContentProps extends ContextMenuStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  labelledBy?: string;
}

export interface ContextMenuItemProps extends ContextMenuStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

export interface ContextMenuGroupProps extends ContextMenuStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  labelledBy?: string;
}

export interface ContextMenuSeparatorProps {
  class?: ClassValue;
  id?: string;
}

export const contextMenuClassNames = defineVariants({
  base: 'text-sm text-neutral-950 data-[disabled]:opacity-50',
  variants: {},
});

export const contextMenuTriggerClassNames = defineVariants({
  base: 'rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-700 outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 data-[state=open]:border-neutral-950 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  variants: {},
});

export const contextMenuContentClassNames = defineVariants({
  base: 'min-w-40 rounded-md border border-neutral-200 bg-white p-1 text-sm text-neutral-950 shadow-md outline-none data-[state=closed]:hidden',
  variants: {},
});

export const contextMenuItemClassNames = defineVariants({
  base: 'flex w-full items-center rounded px-2 py-1.5 text-left text-sm text-neutral-700 outline-none data-[highlighted]:bg-neutral-100 data-[highlighted]:text-neutral-950 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  variants: {},
});

export const contextMenuGroupClassNames = defineVariants({
  base: 'grid gap-1 px-1 py-1 data-[disabled]:opacity-50',
  variants: {},
});

export const contextMenuSeparatorClassNames = defineVariants({
  base: 'my-1 h-px bg-neutral-200',
  variants: {},
});

export const contextMenuClasses = contextMenuClassNames.classes;
export const contextMenuTriggerClasses = contextMenuTriggerClassNames.classes;
export const contextMenuContentClasses = contextMenuContentClassNames.classes;
export const contextMenuItemClasses = contextMenuItemClassNames.classes;
export const contextMenuGroupClasses = contextMenuGroupClassNames.classes;
export const contextMenuSeparatorClasses = contextMenuSeparatorClassNames.classes;

export const ContextMenu = component('context-menu', {
  render(props: ContextMenuProps) {
    const attrs = contextMenuRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.point === undefined ? {} : { point: props.point }),
    });

    return (
      <div
        class={cn(contextMenuClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

export const ContextMenuTrigger = component('context-menu-trigger', {
  render(props: ContextMenuTriggerProps) {
    const attrs = contextMenuTriggerAttributes({
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.point === undefined ? {} : { point: props.point }),
    });

    return (
      <div
        aria-controls={attrs['aria-controls']}
        aria-disabled={attrs['aria-disabled']}
        aria-expanded={attrs['aria-expanded']}
        aria-haspopup={attrs['aria-haspopup']}
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(contextMenuTriggerClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={attrs.id}
        kovo-context-menu={attrs['kovo-context-menu']}
        role={attrs.role}
        tabIndex={props.disabled === true ? -1 : 0}
      >
        {props.children}
      </div>
    );
  },
});

export const ContextMenuContent = component('context-menu-content', {
  render(props: ContextMenuContentProps) {
    const attrs = contextMenuContentAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.point === undefined ? {} : { point: props.point }),
    });

    return (
      <div
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(contextMenuContentClassNames(), props.class)}
        data-anchor-x={attrs['data-anchor-x']}
        data-anchor-y={attrs['data-anchor-y']}
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

export const ContextMenuItem = component('context-menu-item', {
  render(props: ContextMenuItemProps) {
    const attrs = contextMenuItemAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.itemLabel === undefined ? {} : { itemLabel: props.itemLabel }),
      ...(props.items === undefined ? {} : { items: props.items }),
      itemValue: props.itemValue,
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.point === undefined ? {} : { point: props.point }),
    });

    return (
      <button
        aria-disabled={attrs['aria-disabled']}
        class={cn(contextMenuItemClassNames(), props.class)}
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

export const ContextMenuGroup = component('context-menu-group', {
  render(props: ContextMenuGroupProps) {
    const attrs = contextMenuGroupAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.point === undefined ? {} : { point: props.point }),
    });

    return (
      <div
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(contextMenuGroupClassNames(), props.class)}
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

export const ContextMenuSeparator = component('context-menu-separator', {
  render(props: ContextMenuSeparatorProps) {
    const attrs = contextMenuSeparatorAttributes(props.id === undefined ? {} : { id: props.id });

    return (
      <div
        class={cn(contextMenuSeparatorClassNames(), props.class)}
        id={attrs.id}
        role={attrs.role}
      />
    );
  },
});
