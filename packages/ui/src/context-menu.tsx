/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  contextMenuContentAttributes,
  contextMenuGroupAttributes,
  contextMenuItemAttributes,
  contextMenuRootAttributes,
  contextMenuSeparatorAttributes,
  contextMenuTriggerAttributes,
  type ContextMenuItem as HeadlessContextMenuItem,
  type ContextMenuPoint,
} from '@kovojs/headless-ui/context-menu';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

/**
 * Style override slots accepted by the context menu components.
 *
 * @example
 * import type { ContextMenuStyleOverrides } from "@kovojs/ui/context-menu";
 * const styles: ContextMenuStyleOverrides = {};
 */
export interface ContextMenuStyleOverrides {
  content?: style.StyleInput;
  group?: style.StyleInput;
  item?: style.StyleInput;
  root?: style.StyleInput;
  separator?: style.StyleInput;
  trigger?: style.StyleInput;
}

/**
 * Shared state props for the context menu component family.
 *
 * @example
 * import type { ContextMenuStateProps } from "@kovojs/ui/context-menu";
 * const state: ContextMenuStateProps = {};
 */
export interface ContextMenuStateProps {
  disabled?: boolean;
  highlightedValue?: string;
  items?: readonly HeadlessContextMenuItem[];
  open?: boolean;
  point?: ContextMenuPoint;
}

/**
 * Props for the context menu component.
 *
 * @example
 * import type { ContextMenuProps } from "@kovojs/ui/context-menu";
 * const props: ContextMenuProps = { children: 'Content' };
 */
export interface ContextMenuProps extends ContextMenuStateProps {
  children?: string;
  id?: string;
  styles?: ContextMenuStyleOverrides;
}

/**
 * Props for the context menu trigger component.
 *
 * @example
 * import type { ContextMenuTriggerProps } from "@kovojs/ui/context-menu";
 * const props: ContextMenuTriggerProps = { children: 'Content' };
 */
export interface ContextMenuTriggerProps extends ContextMenuStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  labelledBy?: string;
  styles?: ContextMenuStyleOverrides;
}

/**
 * Props for the context menu content component.
 *
 * @example
 * import type { ContextMenuContentProps } from "@kovojs/ui/context-menu";
 * const props: ContextMenuContentProps = { children: 'Content' };
 */
export interface ContextMenuContentProps extends ContextMenuStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: ContextMenuStyleOverrides;
}

/**
 * Props for the context menu item component.
 *
 * @example
 * import type { ContextMenuItemProps } from "@kovojs/ui/context-menu";
 * const props: ContextMenuItemProps = { itemValue: 'item', children: 'Content' };
 */
export interface ContextMenuItemProps extends ContextMenuStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
  styles?: ContextMenuStyleOverrides;
}

/**
 * Props for the context menu group component.
 *
 * @example
 * import type { ContextMenuGroupProps } from "@kovojs/ui/context-menu";
 * const props: ContextMenuGroupProps = { children: 'Content' };
 */
export interface ContextMenuGroupProps extends ContextMenuStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: ContextMenuStyleOverrides;
}

/**
 * Props for the context menu separator component.
 *
 * @example
 * import type { ContextMenuSeparatorProps } from "@kovojs/ui/context-menu";
 * const props: ContextMenuSeparatorProps = {};
 */
export interface ContextMenuSeparatorProps {
  id?: string;
  styles?: ContextMenuStyleOverrides;
}

/**
 * Style definitions used by the context menu components.
 *
 * @example
 * import { contextMenuStyles } from "@kovojs/ui/context-menu";
 * const styles = contextMenuStyles;
 */
export const contextMenuStyles = style.create({
  content: {
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    color: uiTheme.color.foreground,
    fontSize: 14,
    marginTop: 4,
    minWidth: 180,
    outlineStyle: 'none',
    padding: 4,
    position: 'absolute',
    zIndex: 50,
    '[data-state=closed]': {
      display: 'none',
    },
    '[data-state=open]': {
      display: 'block',
    },
  },
  group: {
    display: 'grid',
    gap: 4,
    paddingBlock: 4,
    paddingInline: 4,
    '[data-disabled]': {
      opacity: 0.5,
    },
  },
  item: {
    alignItems: 'center',
    appearance: 'none',
    backgroundColor: 'transparent',
    borderRadius: uiTheme.radius.sm,
    borderStyle: 'none',
    borderWidth: 0,
    color: uiTheme.color.foreground,
    columnGap: 8,
    cursor: 'default',
    display: 'flex',
    font: 'inherit',
    fontSize: 14,
    outlineStyle: 'none',
    paddingBlock: 6,
    paddingInline: 8,
    textAlign: 'left',
    width: '100%',
    '[data-disabled]': {
      opacity: 0.5,
      pointerEvents: 'none',
    },
    '[data-highlighted]': {
      backgroundColor: uiTheme.color.backgroundSubtle,
      color: uiTheme.color.foreground,
    },
    ':focus-visible': {
      backgroundColor: uiTheme.color.backgroundSubtle,
      outlineColor: uiTheme.color.accent,
      outlineOffset: -2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
    ':hover': {
      backgroundColor: uiTheme.color.backgroundSubtle,
      color: uiTheme.color.foreground,
    },
  },
  root: {
    color: uiTheme.color.foreground,
    fontSize: 14,
    position: 'relative',
    '[data-disabled]': {
      opacity: 0.5,
    },
  },
  separator: {
    backgroundColor: uiTheme.color.border,
    height: 1,
    marginBlock: 4,
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: uiTheme.color.backgroundSubtle,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'dashed',
    borderWidth: 1,
    color: uiTheme.color.foregroundMuted,
    display: 'flex',
    fontSize: 14,
    justifyContent: 'center',
    outlineStyle: 'none',
    paddingBlock: 24,
    paddingInline: 16,
    transitionProperty: 'background-color, border-color, color',
    '[data-disabled]': {
      opacity: 0.5,
      pointerEvents: 'none',
    },
    '[data-state=open]': {
      borderColor: uiTheme.color.accent,
      color: uiTheme.color.foreground,
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
    ':hover': {
      borderColor: uiTheme.color.borderStrong,
      color: uiTheme.color.foreground,
    },
  },
});

/**
 * Renders the styled context menu primitive.
 *
 * @example
 * import { ContextMenu } from "@kovojs/ui/context-menu";
 * const component = ContextMenu;
 */
export const ContextMenu = component({
  render(props: ContextMenuProps) {
    const attrs = contextMenuRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.point === undefined ? {} : { point: props.point }),
    });
    const styleAttrs = style.attrs(contextMenuStyles.root, props.styles?.root);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

/**
 * Renders the styled context menu trigger primitive.
 *
 * @example
 * import { ContextMenuTrigger } from "@kovojs/ui/context-menu";
 * const component = ContextMenuTrigger;
 */
export const ContextMenuTrigger = component({
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
    const styleAttrs = style.attrs(contextMenuStyles.trigger, props.styles?.trigger);

    return (
      <div
        aria-controls={attrs['aria-controls']}
        aria-disabled={attrs['aria-disabled']}
        aria-expanded={attrs['aria-expanded']}
        aria-haspopup={attrs['aria-haspopup']}
        aria-labelledby={attrs['aria-labelledby']}
        {...styleAttrs}
        {...passThroughProps(props)}
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

/**
 * Renders the styled context menu content primitive.
 *
 * @example
 * import { ContextMenuContent } from "@kovojs/ui/context-menu";
 * const component = ContextMenuContent;
 */
export const ContextMenuContent = component({
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
    const styleAttrs = style.attrs(contextMenuStyles.content, props.styles?.content);

    return (
      <div
        aria-labelledby={attrs['aria-labelledby']}
        {...styleAttrs}
        {...passThroughProps(props)}
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

/**
 * Renders the styled context menu item primitive.
 *
 * @example
 * import { ContextMenuItem } from "@kovojs/ui/context-menu";
 * const component = ContextMenuItem;
 */
export const ContextMenuItem = component({
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
    const styleAttrs = style.attrs(contextMenuStyles.item, props.styles?.item);

    return (
      <button
        aria-disabled={attrs['aria-disabled']}
        {...styleAttrs}
        {...passThroughProps(props)}
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

/**
 * Renders the styled context menu group primitive.
 *
 * @example
 * import { ContextMenuGroup } from "@kovojs/ui/context-menu";
 * const component = ContextMenuGroup;
 */
export const ContextMenuGroup = component({
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
    const styleAttrs = style.attrs(contextMenuStyles.group, props.styles?.group);

    return (
      <div
        aria-labelledby={attrs['aria-labelledby']}
        {...styleAttrs}
        {...passThroughProps(props)}
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

/**
 * Renders the styled context menu separator primitive.
 *
 * @example
 * import { ContextMenuSeparator } from "@kovojs/ui/context-menu";
 * const component = ContextMenuSeparator;
 */
export const ContextMenuSeparator = component({
  render(props: ContextMenuSeparatorProps) {
    const attrs = contextMenuSeparatorAttributes(props.id === undefined ? {} : { id: props.id });
    const styleAttrs = style.attrs(contextMenuStyles.separator, props.styles?.separator);

    return <div {...styleAttrs} id={attrs.id} role={attrs.role} />;
  },
});
