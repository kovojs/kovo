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
} from '@kovojs/headless-ui';
import * as style from '@kovojs/style';

export interface ContextMenuStyleOverrides {
  content?: style.StyleInput;
  group?: style.StyleInput;
  item?: style.StyleInput;
  root?: style.StyleInput;
  separator?: style.StyleInput;
  trigger?: style.StyleInput;
}

export interface ContextMenuStateProps {
  disabled?: boolean;
  highlightedValue?: string;
  items?: readonly HeadlessContextMenuItem[];
  open?: boolean;
  point?: ContextMenuPoint;
}

export interface ContextMenuProps extends ContextMenuStateProps {
  children?: string;
  id?: string;
  styles?: ContextMenuStyleOverrides;
}

export interface ContextMenuTriggerProps extends ContextMenuStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  labelledBy?: string;
  styles?: ContextMenuStyleOverrides;
}

export interface ContextMenuContentProps extends ContextMenuStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: ContextMenuStyleOverrides;
}

export interface ContextMenuItemProps extends ContextMenuStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
  styles?: ContextMenuStyleOverrides;
}

export interface ContextMenuGroupProps extends ContextMenuStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: ContextMenuStyleOverrides;
}

export interface ContextMenuSeparatorProps {
  id?: string;
  styles?: ContextMenuStyleOverrides;
}

export const contextMenuStyles = style.create(
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
      fontSize: 14,
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
      backgroundColor: '#fafafa',
      borderColor: '#d4d4d4',
      borderRadius: 6,
      borderStyle: 'dashed',
      borderWidth: 1,
      color: '#404040',
      fontSize: 14,
      outlineStyle: 'none',
      paddingBlock: 12,
      paddingInline: 16,
      '[data-disabled]': {
        opacity: 0.5,
        pointerEvents: 'none',
      },
      '[data-state=open]': {
        borderColor: '#0a0a0a',
      },
      ':focus-visible': {
        outlineColor: '#0a0a0a',
        outlineOffset: 2,
        outlineStyle: 'solid',
        outlineWidth: 2,
      },
    },
  },
  { namespace: 'contextMenu', source: 'context-menu.tsx' },
);

export const contextMenuClasses = [style.attrs(contextMenuStyles.root).class ?? ''] as const;
export const contextMenuTriggerClasses = [style.attrs(contextMenuStyles.trigger).class ?? ''] as const;
export const contextMenuContentClasses = [style.attrs(contextMenuStyles.content).class ?? ''] as const;
export const contextMenuItemClasses = [style.attrs(contextMenuStyles.item).class ?? ''] as const;
export const contextMenuGroupClasses = [style.attrs(contextMenuStyles.group).class ?? ''] as const;
export const contextMenuSeparatorClasses = [
  style.attrs(contextMenuStyles.separator).class ?? '',
] as const;

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
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

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

export const ContextMenuSeparator = component({
  render(props: ContextMenuSeparatorProps) {
    const attrs = contextMenuSeparatorAttributes(props.id === undefined ? {} : { id: props.id });
    const styleAttrs = style.attrs(contextMenuStyles.separator, props.styles?.separator);

    return (
      <div
        {...styleAttrs}
        id={attrs.id}
        role={attrs.role}
      />
    );
  },
});
