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

export interface DropdownMenuStyleOverrides {
  content?: style.StyleInput;
  group?: style.StyleInput;
  item?: style.StyleInput;
  root?: style.StyleInput;
  separator?: style.StyleInput;
  trigger?: style.StyleInput;
}

export interface DropdownMenuStateProps {
  disabled?: boolean;
  highlightedValue?: string;
  items?: readonly HeadlessDropdownMenuItem[];
  open?: boolean;
}

export interface DropdownMenuProps extends DropdownMenuStateProps {
  children?: string;
  id?: string;
  styles?: DropdownMenuStyleOverrides;
}

export interface DropdownMenuTriggerProps extends DropdownMenuStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  labelledBy?: string;
  styles?: DropdownMenuStyleOverrides;
}

export interface DropdownMenuContentProps extends DropdownMenuStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: DropdownMenuStyleOverrides;
}

export interface DropdownMenuItemProps extends DropdownMenuStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
  styles?: DropdownMenuStyleOverrides;
}

export interface DropdownMenuGroupProps extends DropdownMenuStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: DropdownMenuStyleOverrides;
}

export interface DropdownMenuSeparatorProps {
  id?: string;
  styles?: DropdownMenuStyleOverrides;
}

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
        {props.children ?? props.itemLabel ?? props.itemValue}
      </button>
    );
  },
});

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

export const DropdownMenuSeparator = component({
  render(props: DropdownMenuSeparatorProps) {
    const attrs = dropdownMenuSeparatorAttributes(props.id === undefined ? {} : { id: props.id });
    const styleAttrs = style.attrs(dropdownMenuStyles.separator, props.styles?.separator);

    return <div {...styleAttrs} id={attrs.id} role={attrs.role} />;
  },
});
