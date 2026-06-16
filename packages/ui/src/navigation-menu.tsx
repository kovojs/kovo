/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { escapeHtml } from '@kovojs/server';
import {
  cn,
  defineVariants,
  navigationMenuContentAttributes,
  navigationMenuIndicatorAttributes,
  navigationMenuItemAttributes,
  navigationMenuLinkAttributes,
  navigationMenuListAttributes,
  navigationMenuRootAttributes,
  navigationMenuTriggerAttributes,
  navigationMenuViewportAttributes,
  type ClassValue,
  type CollectionOrientation,
  type NavigationMenuItem as HeadlessNavigationMenuItem,
  type TextDirection,
} from '@kovojs/headless-ui';

export interface NavigationMenuStateProps {
  activeValue?: string;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly HeadlessNavigationMenuItem[];
  loop?: boolean;
  openValue?: string;
  orientation?: CollectionOrientation;
}

export interface NavigationMenuProps extends NavigationMenuStateProps {
  children?: string;
  class?: ClassValue;
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
}

export interface NavigationMenuListProps extends NavigationMenuStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  labelledBy?: string;
}

export interface NavigationMenuItemProps extends NavigationMenuStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
}

export interface NavigationMenuTriggerProps extends NavigationMenuItemProps {
  contentId?: string;
  itemLabel?: string;
}

export interface NavigationMenuContentProps extends NavigationMenuStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  labelledBy?: string;
  value: string;
}

export interface NavigationMenuLinkProps extends NavigationMenuItemProps {
  href?: string;
  itemLabel?: string;
}

export interface NavigationMenuPartProps extends NavigationMenuStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export const navigationMenuClassNames = defineVariants({
  base: 'relative text-sm text-neutral-950 data-[orientation=vertical]:w-full data-[disabled]:opacity-50',
  variants: {},
});

export const navigationMenuListClassNames = defineVariants({
  base: 'flex list-none items-center gap-1 rounded-md border border-neutral-200 bg-white p-1 shadow-sm data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch',
  variants: {},
});

export const navigationMenuItemClassNames = defineVariants({
  base: 'relative data-[disabled]:opacity-50',
  variants: {},
});

export const navigationMenuTriggerClassNames = defineVariants({
  base: 'inline-flex h-9 items-center rounded px-3 text-sm font-medium text-neutral-700 outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-950 data-[state=open]:bg-neutral-100 data-[highlighted]:bg-neutral-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  variants: {},
});

export const navigationMenuContentClassNames = defineVariants({
  base: 'mt-2 rounded-md border border-neutral-200 bg-white p-3 text-sm text-neutral-700 shadow-md outline-none data-[state=closed]:hidden',
  variants: {},
});

export const navigationMenuLinkClassNames = defineVariants({
  base: 'inline-flex h-9 items-center rounded px-3 text-sm font-medium text-neutral-700 outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-950 data-[highlighted]:bg-neutral-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  variants: {},
});

export const navigationMenuViewportClassNames = defineVariants({
  base: 'mt-2 rounded-md border border-neutral-200 bg-white shadow-md data-[state=closed]:hidden',
  variants: {},
});

export const navigationMenuIndicatorClassNames = defineVariants({
  base: 'h-1 w-8 rounded-full bg-neutral-950 data-[state=closed]:hidden',
  variants: {},
});

export const navigationMenuClasses = navigationMenuClassNames.classes;
export const navigationMenuListClasses = navigationMenuListClassNames.classes;
export const navigationMenuItemClasses = navigationMenuItemClassNames.classes;
export const navigationMenuTriggerClasses = navigationMenuTriggerClassNames.classes;
export const navigationMenuContentClasses = navigationMenuContentClassNames.classes;
export const navigationMenuLinkClasses = navigationMenuLinkClassNames.classes;
export const navigationMenuViewportClasses = navigationMenuViewportClassNames.classes;
export const navigationMenuIndicatorClasses = navigationMenuIndicatorClassNames.classes;

export const NavigationMenu = component('navigation-menu', {
  render(props: NavigationMenuProps) {
    const attrs = navigationMenuRootAttributes({
      ...toNavigationState(props),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
    });

    return (
      <nav
        aria-describedby={attrs['aria-describedby']}
        aria-disabled={attrs['aria-disabled']}
        aria-label={attrs['aria-label']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-orientation={attrs['aria-orientation']}
        class={cn(navigationMenuClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-orientation={attrs['data-orientation']}
        data-state={attrs['data-state']}
        id={attrs.id}
        role={attrs.role}
      >
        {props.children}
      </nav>
    );
  },
});

export const NavigationMenuList = component('navigation-menu-list', {
  render(props: NavigationMenuListProps) {
    const attrs = navigationMenuListAttributes({
      ...toNavigationState(props),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
    });

    return (
      <div
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(navigationMenuListClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-orientation={attrs['data-orientation']}
        data-state={attrs['data-state']}
        id={attrs.id}
        role={attrs.role}
      >
        {props.children}
      </div>
    );
  },
});

export const NavigationMenuItem = component('navigation-menu-item', {
  render(props: NavigationMenuItemProps) {
    const attrs = navigationMenuItemAttributes({
      ...toNavigationState(props),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      itemValue: props.itemValue,
    });

    return (
      <div
        class={cn(navigationMenuItemClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-highlighted={attrs['data-highlighted']}
        data-state={attrs['data-state']}
        id={attrs.id}
        role={attrs.role}
      >
        {props.children}
      </div>
    );
  },
});

export const NavigationMenuTrigger = component('navigation-menu-trigger', {
  render(props: NavigationMenuTriggerProps) {
    const attrs = navigationMenuTriggerAttributes({
      ...toNavigationState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.itemLabel === undefined ? {} : { itemLabel: props.itemLabel }),
      itemValue: props.itemValue,
    });

    return (
      <button
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        aria-haspopup={attrs['aria-haspopup']}
        class={cn(navigationMenuTriggerClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-highlighted={attrs['data-highlighted']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        id={attrs.id}
        tabIndex={attrs.tabIndex}
        type={attrs.type}
        value={attrs.value}
      >
        {/* SECURITY_FINDINGS.md C1: the @kovojs/server JSX runtime renders text children
            UNESCAPED. props.children is the composition slot (raw, may be pre-rendered
            markup); itemLabel/itemValue are scalar text data props a caller fills from
            data, so escape only that fallback to neutralize injected `<img onerror=...>`. */}
        {props.children ?? escapeHtml(props.itemLabel ?? props.itemValue)}
      </button>
    );
  },
});

export const NavigationMenuContent = component('navigation-menu-content', {
  render(props: NavigationMenuContentProps) {
    const attrs = navigationMenuContentAttributes({
      ...toNavigationState(props),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      value: props.value,
    });

    return (
      <div
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(navigationMenuContentClassNames(), props.class)}
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

export const NavigationMenuLink = component('navigation-menu-link', {
  render(props: NavigationMenuLinkProps) {
    const attrs = navigationMenuLinkAttributes({
      ...toNavigationState(props),
      ...(props.href === undefined ? {} : { href: props.href }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.itemLabel === undefined ? {} : { itemLabel: props.itemLabel }),
      itemValue: props.itemValue,
    });

    return (
      <a
        aria-disabled={attrs['aria-disabled']}
        class={cn(navigationMenuLinkClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-highlighted={attrs['data-highlighted']}
        data-state={attrs['data-state']}
        href={attrs.href}
        id={attrs.id}
        tabIndex={attrs.tabIndex}
        value={attrs.value}
      >
        {/*
          SECURITY_FINDINGS.md C1: escape only the scalar itemLabel/itemValue
          text data fallback (rendered unescaped by the JSX runtime); leave
          props.children — the composition slot — raw.
        */}
        {props.children ?? escapeHtml(props.itemLabel ?? props.itemValue)}
      </a>
    );
  },
});

export const NavigationMenuViewport = component('navigation-menu-viewport', {
  render(props: NavigationMenuPartProps) {
    const attrs = navigationMenuViewportAttributes(toNavigationState(props));

    return (
      <div
        class={cn(navigationMenuViewportClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

export const NavigationMenuIndicator = component('navigation-menu-indicator', {
  render(props: NavigationMenuPartProps) {
    const attrs = navigationMenuIndicatorAttributes(toNavigationState(props));

    return (
      <div
        class={cn(navigationMenuIndicatorClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

function toNavigationState(props: NavigationMenuPartProps) {
  return {
    ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
    ...(props.dir === undefined ? {} : { dir: props.dir }),
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    ...(props.id === undefined ? {} : { id: props.id }),
    ...(props.items === undefined ? {} : { items: props.items }),
    ...(props.loop === undefined ? {} : { loop: props.loop }),
    ...(props.openValue === undefined ? {} : { openValue: props.openValue }),
    ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
  };
}
