/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  navigationMenuContentAttributes,
  navigationMenuIndicatorAttributes,
  navigationMenuItemAttributes,
  navigationMenuLinkAttributes,
  navigationMenuListAttributes,
  navigationMenuRootAttributes,
  navigationMenuTriggerAttributes,
  navigationMenuViewportAttributes,
  type NavigationMenuItem as HeadlessNavigationMenuItem,
} from '@kovojs/headless-ui/navigation-menu';
import type { CollectionOrientation, TextDirection } from '@kovojs/headless-ui';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface NavigationMenuStyleOverrides {
  content?: style.StyleInput;
  indicator?: style.StyleInput;
  item?: style.StyleInput;
  link?: style.StyleInput;
  list?: style.StyleInput;
  root?: style.StyleInput;
  trigger?: style.StyleInput;
  viewport?: style.StyleInput;
}

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
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
  styles?: NavigationMenuStyleOverrides;
}

export interface NavigationMenuListProps extends NavigationMenuStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: NavigationMenuStyleOverrides;
}

export interface NavigationMenuItemProps extends NavigationMenuStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: NavigationMenuStyleOverrides;
}

export interface NavigationMenuTriggerProps extends NavigationMenuItemProps {
  contentId?: string;
  itemLabel?: string;
}

export interface NavigationMenuContentProps extends NavigationMenuStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: NavigationMenuStyleOverrides;
  value: string;
}

export interface NavigationMenuLinkProps extends NavigationMenuItemProps {
  href?: string;
  itemLabel?: string;
}

export interface NavigationMenuPartProps extends NavigationMenuStateProps {
  children?: string;
  id?: string;
  styles?: NavigationMenuStyleOverrides;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export const navigationMenuStyles = style.create(
  {
    content: {
      backgroundColor: uiTheme.color.background,
      borderColor: uiTheme.color.border,
      borderRadius: uiTheme.radius.md,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
      color: uiTheme.color.foregroundMuted,
      fontSize: 14,
      marginTop: 8,
      outlineStyle: 'none',
      padding: 12,
      '[data-state=closed]': {
        display: 'none',
      },
    },
    indicator: {
      backgroundColor: uiTheme.color.foreground,
      borderRadius: uiTheme.radius.full,
      height: 4,
      width: 32,
      '[data-state=closed]': {
        display: 'none',
      },
    },
    item: {
      position: 'relative',
      '[data-disabled]': {
        opacity: 0.5,
      },
    },
    link: {
      alignItems: 'center',
      borderRadius: uiTheme.radius.sm,
      color: uiTheme.color.foregroundMuted,
      display: 'inline-flex',
      fontSize: 14,
      fontWeight: 500,
      height: 36,
      outlineStyle: 'none',
      paddingInline: 12,
      transitionProperty: 'background-color, color',
      '[data-disabled]': {
        opacity: 0.5,
        pointerEvents: 'none',
      },
      '[data-highlighted]': {
        backgroundColor: uiTheme.color.backgroundSubtleHigh,
      },
      ':focus-visible': {
        outlineColor: uiTheme.color.borderStrong,
        outlineOffset: 2,
        outlineStyle: 'solid',
        outlineWidth: 2,
      },
      ':hover': {
        backgroundColor: uiTheme.color.backgroundSubtleHigh,
      },
    },
    list: {
      alignItems: 'center',
      backgroundColor: uiTheme.color.background,
      borderColor: uiTheme.color.border,
      borderRadius: uiTheme.radius.md,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
      display: 'flex',
      gap: 4,
      listStyle: 'none',
      padding: 4,
      '[data-orientation=vertical]': {
        alignItems: 'stretch',
        flexDirection: 'column',
      },
    },
    root: {
      color: uiTheme.color.foreground,
      fontSize: 14,
      position: 'relative',
      '[data-disabled]': {
        opacity: 0.5,
      },
      '[data-orientation=vertical]': {
        width: '100%',
      },
    },
    trigger: {
      alignItems: 'center',
      borderRadius: uiTheme.radius.sm,
      color: uiTheme.color.foregroundMuted,
      display: 'inline-flex',
      fontSize: 14,
      fontWeight: 500,
      height: 36,
      outlineStyle: 'none',
      paddingInline: 12,
      transitionProperty: 'background-color, color',
      '[data-disabled]': {
        opacity: 0.5,
        pointerEvents: 'none',
      },
      '[data-highlighted]': {
        backgroundColor: uiTheme.color.backgroundSubtleHigh,
      },
      '[data-state=open]': {
        backgroundColor: uiTheme.color.backgroundSubtleHigh,
      },
      ':focus-visible': {
        outlineColor: uiTheme.color.borderStrong,
        outlineOffset: 2,
        outlineStyle: 'solid',
        outlineWidth: 2,
      },
      ':hover': {
        backgroundColor: uiTheme.color.backgroundSubtleHigh,
      },
    },
    viewport: {
      backgroundColor: uiTheme.color.background,
      borderColor: uiTheme.color.border,
      borderRadius: uiTheme.radius.md,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
      marginTop: 8,
      '[data-state=closed]': {
        display: 'none',
      },
    },
  },
  { namespace: 'navigationMenu', source: 'navigation-menu.tsx' },
);

export const navigationMenuClasses = [style.attrs(navigationMenuStyles.root).class ?? ''] as const;
export const navigationMenuListClasses = [
  style.attrs(navigationMenuStyles.list).class ?? '',
] as const;
export const navigationMenuItemClasses = [
  style.attrs(navigationMenuStyles.item).class ?? '',
] as const;
export const navigationMenuTriggerClasses = [
  style.attrs(navigationMenuStyles.trigger).class ?? '',
] as const;
export const navigationMenuContentClasses = [
  style.attrs(navigationMenuStyles.content).class ?? '',
] as const;
export const navigationMenuLinkClasses = [
  style.attrs(navigationMenuStyles.link).class ?? '',
] as const;
export const navigationMenuViewportClasses = [
  style.attrs(navigationMenuStyles.viewport).class ?? '',
] as const;
export const navigationMenuIndicatorClasses = [
  style.attrs(navigationMenuStyles.indicator).class ?? '',
] as const;

export const NavigationMenu = component({
  render(props: NavigationMenuProps) {
    const attrs = navigationMenuRootAttributes({
      ...toNavigationState(props),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
    });
    const styleAttrs = style.attrs(navigationMenuStyles.root, props.styles?.root);

    return (
      <nav
        aria-describedby={attrs['aria-describedby']}
        aria-disabled={attrs['aria-disabled']}
        aria-label={attrs['aria-label']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-orientation={attrs['aria-orientation']}
        {...styleAttrs}
        {...passThroughProps(props)}
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

export const NavigationMenuList = component({
  render(props: NavigationMenuListProps) {
    const attrs = navigationMenuListAttributes({
      ...toNavigationState(props),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
    });
    const styleAttrs = style.attrs(navigationMenuStyles.list, props.styles?.list);

    return (
      <div
        aria-labelledby={attrs['aria-labelledby']}
        {...styleAttrs}
        {...passThroughProps(props)}
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

export const NavigationMenuItem = component({
  render(props: NavigationMenuItemProps) {
    const attrs = navigationMenuItemAttributes({
      ...toNavigationState(props),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      itemValue: props.itemValue,
    });
    const styleAttrs = style.attrs(navigationMenuStyles.item, props.styles?.item);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
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

export const NavigationMenuTrigger = component({
  render(props: NavigationMenuTriggerProps) {
    const attrs = navigationMenuTriggerAttributes({
      ...toNavigationState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.itemLabel === undefined ? {} : { itemLabel: props.itemLabel }),
      itemValue: props.itemValue,
    });
    const styleAttrs = style.attrs(navigationMenuStyles.trigger, props.styles?.trigger);

    return (
      <button
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        aria-haspopup={attrs['aria-haspopup']}
        {...styleAttrs}
        {...passThroughProps(props)}
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

export const NavigationMenuContent = component({
  render(props: NavigationMenuContentProps) {
    const attrs = navigationMenuContentAttributes({
      ...toNavigationState(props),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      value: props.value,
    });
    const styleAttrs = style.attrs(navigationMenuStyles.content, props.styles?.content);

    return (
      <div
        aria-labelledby={attrs['aria-labelledby']}
        {...styleAttrs}
        {...passThroughProps(props)}
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

export const NavigationMenuLink = component({
  render(props: NavigationMenuLinkProps) {
    const attrs = navigationMenuLinkAttributes({
      ...toNavigationState(props),
      ...(props.href === undefined ? {} : { href: props.href }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.itemLabel === undefined ? {} : { itemLabel: props.itemLabel }),
      itemValue: props.itemValue,
    });
    const styleAttrs = style.attrs(navigationMenuStyles.link, props.styles?.link);

    return (
      <a
        aria-disabled={attrs['aria-disabled']}
        {...styleAttrs}
        {...passThroughProps(props)}
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

export const NavigationMenuViewport = component({
  render(props: NavigationMenuPartProps) {
    const attrs = navigationMenuViewportAttributes(toNavigationState(props));
    const styleAttrs = style.attrs(navigationMenuStyles.viewport, props.styles?.viewport);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
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

export const NavigationMenuIndicator = component({
  render(props: NavigationMenuPartProps) {
    const attrs = navigationMenuIndicatorAttributes(toNavigationState(props));
    const styleAttrs = style.attrs(navigationMenuStyles.indicator, props.styles?.indicator);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
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

export * from '@kovojs/headless-ui/navigation-menu';
