/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  cn,
  defineVariants,
  toolbarButtonAttributes,
  toolbarItemAttributes,
  toolbarRootAttributes,
  type ClassValue,
  type TextDirection,
  type ToolbarItem as HeadlessToolbarItem,
  type ToolbarOrientation,
} from '@kovojs/headless-ui';

export interface ToolbarStateProps {
  activeValue?: string;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly HeadlessToolbarItem[];
  loop?: boolean;
  orientation?: ToolbarOrientation;
}

export interface ToolbarProps extends ToolbarStateProps {
  children?: string;
  class?: ClassValue;
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
}

export interface ToolbarItemProps extends ToolbarStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
}

export interface ToolbarButtonProps extends ToolbarItemProps {
  pressed?: boolean;
}

export const toolbarClassNames = defineVariants({
  base: 'inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white p-1 text-neutral-950 shadow-sm data-[orientation=vertical]:flex-col data-[disabled]:opacity-50',
  variants: {},
});

export const toolbarItemClassNames = defineVariants({
  base: 'inline-flex data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
  variants: {},
});

export const toolbarButtonClassNames = defineVariants({
  base: 'inline-flex h-8 min-w-8 items-center justify-center rounded px-2.5 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 disabled:pointer-events-none data-[pressed=true]:bg-neutral-950 data-[pressed=true]:text-white data-[pressed=true]:shadow-sm data-[disabled]:opacity-50',
  variants: {},
});

export const toolbarClasses = toolbarClassNames.classes;
export const toolbarItemClasses = toolbarItemClassNames.classes;
export const toolbarButtonClasses = toolbarButtonClassNames.classes;

export const Toolbar = component('toolbar', {
  render(props: ToolbarProps) {
    const attrs = toolbarRootAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
    });

    return (
      <div
        aria-describedby={attrs['aria-describedby']}
        aria-disabled={attrs['aria-disabled']}
        aria-label={attrs['aria-label']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-orientation={attrs['aria-orientation']}
        class={cn(toolbarClassNames(), props.class)}
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

export const ToolbarItem = component('toolbar-item', {
  render(props: ToolbarItemProps) {
    const attrs = toolbarItemAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      itemValue: props.itemValue,
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
    });

    return (
      <span
        class={cn(toolbarItemClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        id={attrs.id}
      >
        {props.children}
      </span>
    );
  },
});

export const ToolbarButton = component('toolbar-button', {
  render(props: ToolbarButtonProps) {
    const attrs = toolbarButtonAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      itemValue: props.itemValue,
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.pressed === undefined ? {} : { pressed: props.pressed }),
    });

    return (
      <button
        aria-pressed={attrs['aria-pressed']}
        class={cn(toolbarButtonClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-pressed={attrs['data-pressed']}
        disabled={attrs.disabled}
        id={attrs.id}
        tabIndex={attrs.tabIndex}
        type={attrs.type}
        value={attrs.value}
      >
        {props.children}
      </button>
    );
  },
});
