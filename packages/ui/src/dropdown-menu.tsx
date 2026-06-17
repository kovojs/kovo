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
} from '@kovojs/headless-ui';
import * as style from '@kovojs/style';

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

export const dropdownMenuStyles = style.create(
  {
    content: {
      backgroundColor: '#ffffff',
      borderColor: '#e5e5e5',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
      color: '#0a0a0a',
      fontSize: 14,
      minWidth: 160,
      outlineStyle: 'none',
      padding: 4,
      '[data-state=closed]': {
        display: 'none',
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
      borderRadius: 4,
      color: '#404040',
      display: 'flex',
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
        backgroundColor: '#f5f5f5',
        color: '#0a0a0a',
      },
    },
    root: {
      color: '#0a0a0a',
      display: 'inline-block',
      fontSize: 14,
      position: 'relative',
      '[data-disabled]': {
        opacity: 0.5,
      },
    },
    separator: {
      backgroundColor: '#e5e5e5',
      height: 1,
      marginBlock: 4,
    },
    trigger: {
      alignItems: 'center',
      backgroundColor: '#ffffff',
      borderColor: '#d4d4d4',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
      color: '#0a0a0a',
      display: 'inline-flex',
      fontSize: 14,
      fontWeight: 500,
      height: 36,
      justifyContent: 'center',
      paddingInline: 12,
      transitionProperty: 'background-color, color',
      '[data-state=open]': {
        backgroundColor: '#f5f5f5',
      },
      ':disabled': {
        cursor: 'not-allowed',
        opacity: 0.5,
      },
      ':focus-visible': {
        outlineColor: '#0a0a0a',
        outlineOffset: 2,
        outlineStyle: 'solid',
        outlineWidth: 2,
      },
      ':hover': {
        backgroundColor: '#f5f5f5',
      },
    },
  },
  { namespace: 'dropdownMenu', source: 'dropdown-menu.tsx' },
);

export const dropdownMenuClasses = [style.attrs(dropdownMenuStyles.root).class ?? ''] as const;
export const dropdownMenuTriggerClasses = [style.attrs(dropdownMenuStyles.trigger).class ?? ''] as const;
export const dropdownMenuContentClasses = [style.attrs(dropdownMenuStyles.content).class ?? ''] as const;
export const dropdownMenuItemClasses = [style.attrs(dropdownMenuStyles.item).class ?? ''] as const;
export const dropdownMenuGroupClasses = [style.attrs(dropdownMenuStyles.group).class ?? ''] as const;
export const dropdownMenuSeparatorClasses = [
  style.attrs(dropdownMenuStyles.separator).class ?? '',
] as const;

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

    return (
      <div
        {...styleAttrs}
        id={attrs.id}
        role={attrs.role}
      />
    );
  },
});
