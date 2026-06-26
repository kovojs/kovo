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
import { ChevronDown } from '@kovojs/icons/chevron-down';
import * as style from '@kovojs/style';

import type { CollectionOrientation, TextDirection } from './navigation-types.js';
import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

/**
 * Style override slots accepted by the navigation menu components.
 *
 * @example
 * import type { NavigationMenuStyleOverrides } from "@kovojs/ui/navigation-menu";
 * const styles: NavigationMenuStyleOverrides = {};
 */
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

/**
 * Shared state props for the navigation menu component family.
 *
 * @example
 * import type { NavigationMenuStateProps } from "@kovojs/ui/navigation-menu";
 * const state: NavigationMenuStateProps = {};
 */
export interface NavigationMenuStateProps {
  activeValue?: string;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly HeadlessNavigationMenuItem[];
  loop?: boolean;
  openValue?: string;
  orientation?: CollectionOrientation;
}

/**
 * Props for the navigation menu component.
 *
 * @example
 * import type { NavigationMenuProps } from "@kovojs/ui/navigation-menu";
 * const props: NavigationMenuProps = { children: 'Content' };
 */
export interface NavigationMenuProps extends NavigationMenuStateProps {
  children?: string;
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
  styles?: NavigationMenuStyleOverrides;
}

/**
 * Props for the navigation menu list component.
 *
 * @example
 * import type { NavigationMenuListProps } from "@kovojs/ui/navigation-menu";
 * const props: NavigationMenuListProps = { children: 'Content' };
 */
export interface NavigationMenuListProps extends NavigationMenuStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: NavigationMenuStyleOverrides;
}

/**
 * Props for the navigation menu item component.
 *
 * @example
 * import type { NavigationMenuItemProps } from "@kovojs/ui/navigation-menu";
 * const props: NavigationMenuItemProps = { itemValue: 'item', children: 'Content' };
 */
export interface NavigationMenuItemProps extends NavigationMenuStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: NavigationMenuStyleOverrides;
}

/**
 * Props for the navigation menu trigger component.
 *
 * @example
 * import type { NavigationMenuTriggerProps } from "@kovojs/ui/navigation-menu";
 * const props: NavigationMenuTriggerProps = { itemValue: 'item', children: 'Content' };
 */
export interface NavigationMenuTriggerProps extends NavigationMenuItemProps {
  contentId?: string;
  itemLabel?: string;
}

/**
 * Props for the navigation menu content component.
 *
 * @example
 * import type { NavigationMenuContentProps } from "@kovojs/ui/navigation-menu";
 * const props: NavigationMenuContentProps = { value: 'value', children: 'Content' };
 */
export interface NavigationMenuContentProps extends NavigationMenuStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: NavigationMenuStyleOverrides;
  value: string;
}

/**
 * Props for the navigation menu link component.
 *
 * @example
 * import type { NavigationMenuLinkProps } from "@kovojs/ui/navigation-menu";
 * const props: NavigationMenuLinkProps = { itemValue: 'item', children: 'Content' };
 */
export interface NavigationMenuLinkProps extends NavigationMenuItemProps {
  href?: string;
  itemLabel?: string;
}

/**
 * Props for the navigation menu part component.
 *
 * @example
 * import type { NavigationMenuPartProps } from "@kovojs/ui/navigation-menu";
 * const props: NavigationMenuPartProps = { children: 'Content' };
 */
export interface NavigationMenuPartProps extends NavigationMenuStateProps {
  children?: string;
  id?: string;
  styles?: NavigationMenuStyleOverrides;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Style definitions used by the navigation menu components.
 *
 * @example
 * import { navigationMenuStyles } from "@kovojs/ui/navigation-menu";
 * const styles = navigationMenuStyles;
 */
export const navigationMenuStyles = style.create({
  content: {
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    color: uiTheme.color.foregroundMuted,
    fontSize: 14,
    marginTop: 4,
    minWidth: 180,
    outlineStyle: 'none',
    padding: 12,
    position: 'absolute',
    zIndex: 50,
    // Subtle open/close motion: fade + small slide. We animate opacity/transform
    // only — `display` is toggled (not transitioned) by the [data-state] rules so
    // the panel still fully unmounts from layout when closed.
    transitionDuration: '160ms',
    transitionProperty: 'opacity, transform',
    transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
    '[data-state=closed]': {
      display: 'none',
      opacity: 0,
      transform: 'translateY(-4px)',
    },
    '[data-state=open]': {
      display: 'block',
      opacity: 1,
      transform: 'translateY(0)',
    },
    // shadcn-style hover feedback for link rows inside the content panel. The
    // demo composes plain <a> rows (inline styles can't express :hover), so the
    // panel owns the hover affordance via this descendant rule. Keyed off the
    // always-present [data-state] so the engine treats it as a nested selector
    // (a leading-space/bare-element key is parsed as a property and dropped).
    '[data-state] a': {
      transitionProperty: 'background-color',
      transitionDuration: '120ms',
    },
    '[data-state] a:hover': {
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
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
    color: uiTheme.color.foreground,
    display: 'inline-flex',
    fontSize: 14,
    fontWeight: 500,
    height: 36,
    outlineStyle: 'none',
    paddingInline: 12,
    textDecoration: 'none',
    transitionProperty: 'background-color, color',
    '[data-disabled]': {
      opacity: 0.5,
      pointerEvents: 'none',
    },
    '[data-highlighted]': {
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
    ':hover': {
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
    },
  },
  list: {
    // De-boxed (shadcn-style): no border/shadow on the menubar itself so it isn't
    // double-chromed above the bordered content panel; it's just a row of triggers.
    alignItems: 'center',
    backgroundColor: 'transparent',
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
    appearance: 'none',
    backgroundColor: 'transparent',
    borderRadius: uiTheme.radius.sm,
    borderStyle: 'none',
    borderWidth: 0,
    color: uiTheme.color.foreground,
    display: 'inline-flex',
    font: 'inherit',
    fontSize: 14,
    fontWeight: 500,
    // shadcn-style: real ChevronDown icon child (see triggerIcon) instead of a CSS
    // rotated-border caret; gap spaces the label from the icon.
    gap: 4,
    height: 36,
    outlineStyle: 'none',
    paddingInline: 12,
    textAlign: 'left',
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
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
    ':hover': {
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
    },
  },
  // ChevronDown affordance on the trigger. Sized down from the 24px Lucide default
  // and tinted muted; it carries the trigger's [data-state] (forwarded to the svg)
  // so it can rotate 180deg when the menu is open via a transform transition.
  triggerIcon: {
    color: uiTheme.color.foregroundMuted,
    flexShrink: 0,
    height: 16,
    transitionProperty: 'transform',
    transitionDuration: '200ms',
    width: 16,
    '[data-state=open]': {
      transform: 'rotate(180deg)',
    },
  },
  viewport: {
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    marginTop: 4,
    minWidth: 180,
    position: 'absolute',
    zIndex: 50,
    '[data-state=closed]': {
      display: 'none',
    },
    '[data-state=open]': {
      display: 'block',
    },
  },
});

/**
 * Renders the styled navigation menu primitive.
 *
 * @example
 * import { NavigationMenu } from "@kovojs/ui/navigation-menu";
 * const component = NavigationMenu;
 */
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

/**
 * Renders the styled navigation menu list primitive.
 *
 * @example
 * import { NavigationMenuList } from "@kovojs/ui/navigation-menu";
 * const component = NavigationMenuList;
 */
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

/**
 * Renders the styled navigation menu item primitive.
 *
 * @example
 * import { NavigationMenuItem } from "@kovojs/ui/navigation-menu";
 * const component = NavigationMenuItem;
 */
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

/**
 * Renders the styled navigation menu trigger primitive.
 *
 * @example
 * import { NavigationMenuTrigger } from "@kovojs/ui/navigation-menu";
 * const component = NavigationMenuTrigger;
 */
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
        {/* shadcn-style chevron: a real (decorative) icon child carrying the trigger's
            [data-state] so triggerIcon can rotate it 180deg when the menu is open. */}
        <ChevronDown style={navigationMenuStyles.triggerIcon} data-state={attrs['data-state']} />
      </button>
    );
  },
});

/**
 * Renders the styled navigation menu content primitive.
 *
 * @example
 * import { NavigationMenuContent } from "@kovojs/ui/navigation-menu";
 * const component = NavigationMenuContent;
 */
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

/**
 * Renders the styled navigation menu link primitive.
 *
 * @example
 * import { NavigationMenuLink } from "@kovojs/ui/navigation-menu";
 * const component = NavigationMenuLink;
 */
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

/**
 * Renders the styled navigation menu viewport primitive.
 *
 * @example
 * import { NavigationMenuViewport } from "@kovojs/ui/navigation-menu";
 * const component = NavigationMenuViewport;
 */
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

/**
 * Renders the styled navigation menu indicator primitive.
 *
 * @example
 * import { NavigationMenuIndicator } from "@kovojs/ui/navigation-menu";
 * const component = NavigationMenuIndicator;
 */
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
