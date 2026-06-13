/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  cn,
  defineVariants,
  menubarGroupAttributes,
  menubarItemAttributes,
  menubarRootAttributes,
  menubarSeparatorAttributes,
  menubarSubmenuAttributes,
  type ClassValue,
  type CollectionOrientation,
  type MenubarItem as HeadlessMenubarItem,
  type TextDirection,
} from '@jiso/headless-ui';

export interface MenubarStateProps {
  activeValue?: string;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly HeadlessMenubarItem[];
  loop?: boolean;
  openValue?: string;
  orientation?: CollectionOrientation;
}

export interface MenubarProps extends MenubarStateProps {
  children?: string;
  class?: ClassValue;
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
}

export interface MenubarItemProps extends MenubarStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemParentValue?: string;
  itemValue: string;
}

export interface MenubarSubmenuProps extends MenubarStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  labelledBy?: string;
  value: string;
}

export interface MenubarGroupProps extends MenubarStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  labelledBy?: string;
}

export interface MenubarSeparatorProps {
  class?: ClassValue;
  id?: string;
}

export const menubarClassNames = defineVariants({
  base: 'inline-flex rounded-md border border-neutral-200 bg-white p-1 text-sm text-neutral-950 shadow-sm data-[orientation=vertical]:flex-col data-[disabled]:opacity-50',
  variants: {},
});

export const menubarItemClassNames = defineVariants({
  base: 'inline-flex h-8 items-center rounded px-2.5 text-sm text-neutral-700 outline-none data-[state=open]:bg-neutral-100 data-[highlighted]:bg-neutral-100 data-[highlighted]:text-neutral-950 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  variants: {},
});

export const menubarSubmenuClassNames = defineVariants({
  base: 'min-w-40 rounded-md border border-neutral-200 bg-white p-1 text-sm text-neutral-950 shadow-md outline-none data-[state=closed]:hidden',
  variants: {},
});

export const menubarGroupClassNames = defineVariants({
  base: 'grid gap-1 px-1 py-1 data-[disabled]:opacity-50',
  variants: {},
});

export const menubarSeparatorClassNames = defineVariants({
  base: 'my-1 h-px bg-neutral-200',
  variants: {},
});

export const menubarClasses = menubarClassNames.classes;
export const menubarItemClasses = menubarItemClassNames.classes;
export const menubarSubmenuClasses = menubarSubmenuClassNames.classes;
export const menubarGroupClasses = menubarGroupClassNames.classes;
export const menubarSeparatorClasses = menubarSeparatorClassNames.classes;

export const Menubar = component('menubar', {
  render(props: MenubarProps) {
    const attrs = menubarRootAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.openValue === undefined ? {} : { openValue: props.openValue }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
    });

    return (
      <div
        aria-describedby={attrs['aria-describedby']}
        aria-disabled={attrs['aria-disabled']}
        aria-label={attrs['aria-label']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-orientation={attrs['aria-orientation']}
        class={cn(menubarClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-orientation={attrs['data-orientation']}
        id={attrs.id}
        role={attrs.role}
      >
        {props.children}
      </div>
    );
  },
});

export const MenubarItem = component('menubar-item', {
  render(props: MenubarItemProps) {
    const attrs = menubarItemAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.itemLabel === undefined ? {} : { itemLabel: props.itemLabel }),
      ...(props.itemParentValue === undefined ? {} : { itemParentValue: props.itemParentValue }),
      itemValue: props.itemValue,
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.openValue === undefined ? {} : { openValue: props.openValue }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
    });

    return (
      <button
        aria-controls={attrs['aria-controls']}
        aria-disabled={attrs['aria-disabled']}
        aria-expanded={attrs['aria-expanded']}
        aria-haspopup={attrs['aria-haspopup']}
        class={cn(menubarItemClassNames(), props.class)}
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

export const MenubarSubmenu = component('menubar-submenu', {
  render(props: MenubarSubmenuProps) {
    const attrs = menubarSubmenuAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.openValue === undefined ? {} : { openValue: props.openValue }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      value: props.value,
    });

    return (
      <div
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(menubarSubmenuClassNames(), props.class)}
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

export const MenubarGroup = component('menubar-group', {
  render(props: MenubarGroupProps) {
    const attrs = menubarGroupAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.openValue === undefined ? {} : { openValue: props.openValue }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
    });

    return (
      <div
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(menubarGroupClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-orientation={attrs['data-orientation']}
        id={attrs.id}
        role={attrs.role}
      >
        {props.children}
      </div>
    );
  },
});

export const MenubarSeparator = component('menubar-separator', {
  render(props: MenubarSeparatorProps) {
    const attrs = menubarSeparatorAttributes(props.id === undefined ? {} : { id: props.id });

    return (
      <div class={cn(menubarSeparatorClassNames(), props.class)} id={attrs.id} role={attrs.role} />
    );
  },
});
