/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  cn,
  defineVariants,
  tabsListAttributes,
  tabsPanelAttributes,
  tabsRootAttributes,
  tabsTriggerAttributes,
  type ClassValue,
  type CollectionOrientation,
  type TabsActivationMode,
  type TabsItem,
  type TextDirection,
} from '@jiso/headless-ui';

export interface TabsStateProps {
  activationMode?: TabsActivationMode;
  activeValue?: string;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly TabsItem[];
  loop?: boolean;
  orientation?: CollectionOrientation;
  value?: string;
}

export interface TabsProps extends TabsStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface TabsListProps extends TabsStateProps {
  children?: string;
  class?: ClassValue;
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
}

export interface TabsTriggerProps extends TabsStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  panelId?: string;
}

export interface TabsPanelProps extends TabsStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  triggerId?: string;
}

export const tabsClassNames = defineVariants({
  base: 'w-full text-neutral-950 data-[disabled]:opacity-50',
  variants: {},
});

export const tabsListClassNames = defineVariants({
  base: 'inline-flex h-10 items-center gap-1 rounded-md border border-neutral-200 bg-neutral-100 p-1 data-[orientation=vertical]:h-auto data-[orientation=vertical]:flex-col data-[disabled]:opacity-50',
  variants: {},
});

export const tabsTriggerClassNames = defineVariants({
  base: 'inline-flex h-8 items-center justify-center rounded px-3 text-sm font-medium text-neutral-600 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 disabled:pointer-events-none data-[state=active]:bg-white data-[state=active]:text-neutral-950 data-[state=active]:shadow-sm data-[disabled]:opacity-50',
  variants: {},
});

export const tabsPanelClassNames = defineVariants({
  base: 'mt-3 rounded-md border border-neutral-200 bg-white p-4 text-sm text-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400',
  variants: {},
});

export const tabsClasses = tabsClassNames.classes;
export const tabsListClasses = tabsListClassNames.classes;
export const tabsTriggerClasses = tabsTriggerClassNames.classes;
export const tabsPanelClasses = tabsPanelClassNames.classes;

export const Tabs = component('tabs', {
  render(props: TabsProps) {
    const attrs = tabsRootAttributes({
      ...(props.activationMode === undefined ? {} : { activationMode: props.activationMode }),
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <div
        class={cn(tabsClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-orientation={attrs['data-orientation']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

export const TabsList = component('tabs-list', {
  render(props: TabsListProps) {
    const attrs = tabsListAttributes({
      ...(props.activationMode === undefined ? {} : { activationMode: props.activationMode }),
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
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <div
        aria-describedby={attrs['aria-describedby']}
        aria-disabled={attrs['aria-disabled']}
        aria-label={attrs['aria-label']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-orientation={attrs['aria-orientation']}
        class={cn(tabsListClassNames(), props.class)}
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

export const TabsTrigger = component('tabs-trigger', {
  render(props: TabsTriggerProps) {
    const attrs = tabsTriggerAttributes({
      ...(props.activationMode === undefined ? {} : { activationMode: props.activationMode }),
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.items === undefined ? {} : { items: props.items }),
      itemValue: props.itemValue,
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.panelId === undefined ? {} : { panelId: props.panelId }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <button
        aria-controls={attrs['aria-controls']}
        aria-selected={attrs['aria-selected']}
        class={cn(tabsTriggerClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        id={attrs.id}
        role={attrs.role}
        tabIndex={attrs.tabIndex}
        type={attrs.type}
        value={attrs.value}
      >
        {props.children}
      </button>
    );
  },
});

export const TabsPanel = component('tabs-panel', {
  render(props: TabsPanelProps) {
    const attrs = tabsPanelAttributes({
      ...(props.activationMode === undefined ? {} : { activationMode: props.activationMode }),
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.items === undefined ? {} : { items: props.items }),
      itemValue: props.itemValue,
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.triggerId === undefined ? {} : { triggerId: props.triggerId }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <section
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(tabsPanelClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
        role={attrs.role}
        tabIndex={attrs.tabIndex}
      >
        {props.children}
      </section>
    );
  },
});
