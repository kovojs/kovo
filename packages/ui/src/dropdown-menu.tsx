/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  dropdownMenuContentAttributes,
  dropdownMenuGroupAttributes,
  dropdownMenuItemAttributes,
  dropdownMenuRootAttributes,
  dropdownMenuSeparatorAttributes,
  dropdownMenuTriggerAttributes,
  type DropdownMenuItem as HeadlessDropdownMenuItem,
} from '@kovojs/headless-ui/dropdown-menu';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

/**
 * Style override slots accepted by the dropdown menu components.
 *
 * @example
 * import type { DropdownMenuStyleOverrides } from "@kovojs/ui/dropdown-menu";
 * const styles: DropdownMenuStyleOverrides = {};
 */
export interface DropdownMenuStyleOverrides {
  content?: style.StyleInput;
  group?: style.StyleInput;
  item?: style.StyleInput;
  root?: style.StyleInput;
  separator?: style.StyleInput;
  trigger?: style.StyleInput;
}

/**
 * Shared state props for the dropdown menu component family.
 *
 * @example
 * import type { DropdownMenuStateProps } from "@kovojs/ui/dropdown-menu";
 * const state: DropdownMenuStateProps = {};
 */
export interface DropdownMenuStateProps {
  disabled?: boolean;
  highlightedValue?: string;
  items?: readonly HeadlessDropdownMenuItem[];
  open?: boolean;
}

/**
 * Props for the dropdown menu component.
 *
 * @example
 * import type { DropdownMenuProps } from "@kovojs/ui/dropdown-menu";
 * const props: DropdownMenuProps = { children: 'Content' };
 */
export interface DropdownMenuProps extends DropdownMenuStateProps {
  children?: string;
  id?: string;
  styles?: DropdownMenuStyleOverrides;
}

/**
 * Props for the dropdown menu trigger component.
 *
 * @example
 * import type { DropdownMenuTriggerProps } from "@kovojs/ui/dropdown-menu";
 * const props: DropdownMenuTriggerProps = { children: 'Content' };
 */
export interface DropdownMenuTriggerProps extends DropdownMenuStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  labelledBy?: string;
  styles?: DropdownMenuStyleOverrides;
}

/**
 * Props for the dropdown menu content component.
 *
 * @example
 * import type { DropdownMenuContentProps } from "@kovojs/ui/dropdown-menu";
 * const props: DropdownMenuContentProps = { children: 'Content' };
 */
export interface DropdownMenuContentProps extends DropdownMenuStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: DropdownMenuStyleOverrides;
}

/**
 * Props for the dropdown menu item component.
 *
 * @example
 * import type { DropdownMenuItemProps } from "@kovojs/ui/dropdown-menu";
 * const props: DropdownMenuItemProps = { itemValue: 'item', children: 'Content' };
 */
export interface DropdownMenuItemProps extends DropdownMenuStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
  styles?: DropdownMenuStyleOverrides;
}

/**
 * Props for the dropdown menu group component.
 *
 * @example
 * import type { DropdownMenuGroupProps } from "@kovojs/ui/dropdown-menu";
 * const props: DropdownMenuGroupProps = { children: 'Content' };
 */
export interface DropdownMenuGroupProps extends DropdownMenuStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: DropdownMenuStyleOverrides;
}

/**
 * Props for the dropdown menu separator component.
 *
 * @example
 * import type { DropdownMenuSeparatorProps } from "@kovojs/ui/dropdown-menu";
 * const props: DropdownMenuSeparatorProps = {};
 */
export interface DropdownMenuSeparatorProps {
  id?: string;
  styles?: DropdownMenuStyleOverrides;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Style definitions used by the dropdown menu components.
 *
 * @example
 * import { dropdownMenuStyles } from "@kovojs/ui/dropdown-menu";
 * const styles = dropdownMenuStyles;
 */
export const dropdownMenuStyles = style.create({
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
    display: 'inline-block',
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
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.borderStrong,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
    color: uiTheme.color.foreground,
    display: 'inline-flex',
    fontSize: 14,
    fontWeight: 500,
    height: 36,
    justifyContent: 'center',
    paddingInline: 12,
    transitionProperty: 'background-color, color',
    '[data-state=open]': {
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
    },
    ':disabled': {
      cursor: 'not-allowed',
      opacity: 0.5,
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
});

/**
 * Renders the styled dropdown menu primitive.
 *
 * @example
 * import { DropdownMenu } from "@kovojs/ui/dropdown-menu";
 * const component = DropdownMenu;
 */
export const DropdownMenu = component({
  render(props: DropdownMenuProps) {
    const attrs = dropdownMenuRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.open === undefined ? {} : { open: props.open }),
    });
    const styleAttrs = style.attrs(dropdownMenuStyles.root, props.styles?.root);

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
 * Renders the styled dropdown menu trigger primitive.
 *
 * @example
 * import { DropdownMenuTrigger } from "@kovojs/ui/dropdown-menu";
 * const component = DropdownMenuTrigger;
 */
export const DropdownMenuTrigger = component({
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
    const styleAttrs = style.attrs(dropdownMenuStyles.trigger, props.styles?.trigger);

    return (
      <button
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        aria-haspopup={attrs['aria-haspopup']}
        aria-labelledby={attrs['aria-labelledby']}
        {...styleAttrs}
        {...passThroughProps(props)}
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

/**
 * Renders the styled dropdown menu content primitive.
 *
 * @example
 * import { DropdownMenuContent } from "@kovojs/ui/dropdown-menu";
 * const component = DropdownMenuContent;
 */
export const DropdownMenuContent = component({
  render(props: DropdownMenuContentProps) {
    const attrs = dropdownMenuContentAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.open === undefined ? {} : { open: props.open }),
    });
    const styleAttrs = style.attrs(dropdownMenuStyles.content, props.styles?.content);

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
 * Renders the styled dropdown menu item primitive.
 *
 * @example
 * import { DropdownMenuItem } from "@kovojs/ui/dropdown-menu";
 * const component = DropdownMenuItem;
 */
export const DropdownMenuItem = component({
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
    const styleAttrs = style.attrs(dropdownMenuStyles.item, props.styles?.item);

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
        {props.children ?? escapeHtml(props.itemLabel ?? props.itemValue)}
      </button>
    );
  },
});

/**
 * Renders the styled dropdown menu group primitive.
 *
 * @example
 * import { DropdownMenuGroup } from "@kovojs/ui/dropdown-menu";
 * const component = DropdownMenuGroup;
 */
export const DropdownMenuGroup = component({
  render(props: DropdownMenuGroupProps) {
    const attrs = dropdownMenuGroupAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.open === undefined ? {} : { open: props.open }),
    });
    const styleAttrs = style.attrs(dropdownMenuStyles.group, props.styles?.group);

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
 * Renders the styled dropdown menu separator primitive.
 *
 * @example
 * import { DropdownMenuSeparator } from "@kovojs/ui/dropdown-menu";
 * const component = DropdownMenuSeparator;
 */
export const DropdownMenuSeparator = component({
  render(props: DropdownMenuSeparatorProps) {
    const attrs = dropdownMenuSeparatorAttributes(props.id === undefined ? {} : { id: props.id });
    const styleAttrs = style.attrs(dropdownMenuStyles.separator, props.styles?.separator);

    return <div {...styleAttrs} id={attrs.id} role={attrs.role} />;
  },
});
