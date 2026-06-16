/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  cn,
  defineVariants,
  toggleGroupButtonAttributes,
  toggleGroupItemAttributes,
  toggleGroupRootAttributes,
  type ClassValue,
  type CollectionOrientation,
  type TextDirection,
  type ToggleGroupItem as HeadlessToggleGroupItem,
  type ToggleGroupType,
  type ToggleGroupValue,
} from '@kovojs/headless-ui';

export interface ToggleGroupStateProps {
  activeValue?: string;
  collapsible?: boolean;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly HeadlessToggleGroupItem[];
  loop?: boolean;
  orientation?: CollectionOrientation;
  type?: ToggleGroupType;
  value?: ToggleGroupValue;
}

export interface ToggleGroupProps extends ToggleGroupStateProps {
  children?: string;
  class?: ClassValue;
  descriptionId?: string;
  id?: string;
  labelledBy?: string;
}

export interface ToggleGroupItemProps extends ToggleGroupStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
}

export interface ToggleGroupButtonProps extends ToggleGroupStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
}

export const toggleGroupClassNames = defineVariants({
  base: 'inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-100 p-1 text-neutral-950 data-[orientation=vertical]:flex-col data-[disabled]:opacity-50',
  variants: {},
});

export const toggleGroupItemClassNames = defineVariants({
  base: 'inline-flex data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
  variants: {},
});

export const toggleGroupButtonClassNames = defineVariants({
  base: 'inline-flex h-8 min-w-8 items-center justify-center rounded px-2.5 text-sm font-medium text-neutral-600 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 disabled:pointer-events-none data-[state=pressed]:bg-white data-[state=pressed]:text-neutral-950 data-[state=pressed]:shadow-sm data-[disabled]:opacity-50',
  variants: {},
});

export const toggleGroupClasses = toggleGroupClassNames.classes;
export const toggleGroupItemClasses = toggleGroupItemClassNames.classes;
export const toggleGroupButtonClasses = toggleGroupButtonClassNames.classes;

export const ToggleGroup = component({
  render(props: ToggleGroupProps) {
    const attrs = toggleGroupRootAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.collapsible === undefined ? {} : { collapsible: props.collapsible }),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.type === undefined ? {} : { type: props.type }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <div
        aria-describedby={attrs['aria-describedby']}
        aria-disabled={attrs['aria-disabled']}
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(toggleGroupClassNames(), props.class)}
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

export const ToggleGroupItem = component({
  render(props: ToggleGroupItemProps) {
    const attrs = toggleGroupItemAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.collapsible === undefined ? {} : { collapsible: props.collapsible }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      itemValue: props.itemValue,
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.type === undefined ? {} : { type: props.type }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <span
        class={cn(toggleGroupItemClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={attrs.id}
      >
        {props.children}
      </span>
    );
  },
});

export const ToggleGroupButton = component({
  render(props: ToggleGroupButtonProps) {
    const attrs = toggleGroupButtonAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.collapsible === undefined ? {} : { collapsible: props.collapsible }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      itemValue: props.itemValue,
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.type === undefined ? {} : { type: props.type }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <button
        aria-pressed={attrs['aria-pressed']}
        class={cn(toggleGroupButtonClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
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
