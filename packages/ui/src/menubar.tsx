/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  menubarGroupAttributes,
  menubarItemAttributes,
  menubarRootAttributes,
  menubarSeparatorAttributes,
  menubarSubmenuAttributes,
  type MenubarItem as HeadlessMenubarItem,
} from '@kovojs/headless-ui/menubar';
import type { CollectionOrientation, TextDirection } from '@kovojs/headless-ui';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface MenubarStyleOverrides {
  group?: style.StyleInput;
  item?: style.StyleInput;
  root?: style.StyleInput;
  separator?: style.StyleInput;
  submenu?: style.StyleInput;
}

export interface MenubarStateProps {
  activeValue?: string;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly HeadlessMenubarItem[];
  loop?: boolean;
  openValue?: string;
  orientation?: CollectionOrientation;
}

export interface MenubarProps extends MenubarStateProps {
  children?: string;
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
  styles?: MenubarStyleOverrides;
}

export interface MenubarItemProps extends MenubarStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemParentValue?: string;
  itemValue: string;
  styles?: MenubarStyleOverrides;
}

export interface MenubarSubmenuProps extends MenubarStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: MenubarStyleOverrides;
  value: string;
}

export interface MenubarGroupProps extends MenubarStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: MenubarStyleOverrides;
}

export interface MenubarSeparatorProps {
  id?: string;
  styles?: MenubarStyleOverrides;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export const menubarStyles = style.create(
  {
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
      borderRadius: uiTheme.radius.sm,
      color: uiTheme.color.foregroundMuted,
      cursor: 'default',
      display: 'inline-flex',
      fontSize: 14,
      height: 32,
      outlineStyle: 'none',
      paddingInline: 10,
      position: 'relative',
      '[data-disabled]': {
        opacity: 0.5,
        pointerEvents: 'none',
      },
      '[data-highlighted]': {
        backgroundColor: uiTheme.color.backgroundSubtle,
        color: uiTheme.color.foreground,
      },
      '[data-state=open]': {
        backgroundColor: uiTheme.color.backgroundSubtle,
        color: uiTheme.color.foreground,
      },
      ':hover': {
        backgroundColor: uiTheme.color.backgroundSubtle,
        color: uiTheme.color.foreground,
      },
    },
    root: {
      backgroundColor: uiTheme.color.background,
      borderColor: uiTheme.color.border,
      borderRadius: uiTheme.radius.md,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
      color: uiTheme.color.foreground,
      display: 'inline-flex',
      fontSize: 14,
      padding: 4,
      '[data-disabled]': {
        opacity: 0.5,
      },
      '[data-orientation=vertical]': {
        flexDirection: 'column',
      },
    },
    separator: {
      backgroundColor: uiTheme.color.border,
      height: 1,
      marginBlock: 4,
    },
    submenu: {
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
  },
  { namespace: 'menubar', source: 'menubar.tsx' },
);

export const menubarClasses = [style.attrs(menubarStyles.root).class ?? ''] as const;
export const menubarItemClasses = [style.attrs(menubarStyles.item).class ?? ''] as const;
export const menubarSubmenuClasses = [style.attrs(menubarStyles.submenu).class ?? ''] as const;
export const menubarGroupClasses = [style.attrs(menubarStyles.group).class ?? ''] as const;
export const menubarSeparatorClasses = [style.attrs(menubarStyles.separator).class ?? ''] as const;

export const Menubar = component({
  render(props: MenubarProps) {
    const attrs = menubarRootAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.openValue === undefined ? {} : { openValue: props.openValue }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
    });
    const styleAttrs = style.attrs(menubarStyles.root, props.styles?.root);

    return (
      <div
        aria-describedby={attrs['aria-describedby']}
        aria-disabled={attrs['aria-disabled']}
        aria-label={attrs['aria-label']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-orientation={attrs['aria-orientation']}
        {...styleAttrs}
        {...passThroughProps(props)}
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

export const MenubarItem = component({
  render(props: MenubarItemProps) {
    const attrs = menubarItemAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.itemLabel === undefined ? {} : { itemLabel: props.itemLabel }),
      ...(props.itemParentValue === undefined ? {} : { itemParentValue: props.itemParentValue }),
      itemValue: props.itemValue,
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.openValue === undefined ? {} : { openValue: props.openValue }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
    });
    const styleAttrs = style.attrs(menubarStyles.item, props.styles?.item);

    return (
      <button
        aria-controls={attrs['aria-controls']}
        aria-disabled={attrs['aria-disabled']}
        aria-expanded={attrs['aria-expanded']}
        aria-haspopup={attrs['aria-haspopup']}
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
        {props.children ?? escapeHtml(props.itemLabel ?? props.itemValue ?? '')}
      </button>
    );
  },
});

export const MenubarSubmenu = component({
  render(props: MenubarSubmenuProps) {
    const attrs = menubarSubmenuAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.openValue === undefined ? {} : { openValue: props.openValue }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      value: props.value,
    });
    const styleAttrs = style.attrs(menubarStyles.submenu, props.styles?.submenu);

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

export const MenubarGroup = component({
  render(props: MenubarGroupProps) {
    const attrs = menubarGroupAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.openValue === undefined ? {} : { openValue: props.openValue }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
    });
    const styleAttrs = style.attrs(menubarStyles.group, props.styles?.group);

    return (
      <div
        aria-labelledby={attrs['aria-labelledby']}
        {...styleAttrs}
        {...passThroughProps(props)}
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

export const MenubarSeparator = component({
  render(props: MenubarSeparatorProps) {
    const attrs = menubarSeparatorAttributes(props.id === undefined ? {} : { id: props.id });
    const styleAttrs = style.attrs(menubarStyles.separator, props.styles?.separator);

    return <div {...styleAttrs} id={attrs.id} role={attrs.role} />;
  },
});

export * from '@kovojs/headless-ui/menubar';
