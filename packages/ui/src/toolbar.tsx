/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  toolbarButtonAttributes,
  toolbarItemAttributes,
  toolbarRootAttributes,
  type TextDirection,
  type ToolbarItem as HeadlessToolbarItem,
  type ToolbarOrientation,
} from '@kovojs/headless-ui';
import * as style from '@kovojs/style';

export interface ToolbarStyleOverrides {
  button?: style.StyleInput;
  item?: style.StyleInput;
  root?: style.StyleInput;
}

export interface ToolbarStateProps {
  activeValue?: string;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly HeadlessToolbarItem[];
  loop?: boolean;
  orientation?: ToolbarOrientation;
}

export interface ToolbarProps extends ToolbarStateProps {
  children?: string;
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
  styles?: ToolbarStyleOverrides;
}

export interface ToolbarItemProps extends ToolbarStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: ToolbarStyleOverrides;
}

export interface ToolbarButtonProps extends ToolbarItemProps {
  pressed?: boolean;
}

export const toolbarStyles = style.create(
  {
    button: {
      alignItems: 'center',
      borderRadius: 4,
      color: '#525252',
      display: 'inline-flex',
      fontSize: 14,
      fontWeight: 500,
      height: 32,
      justifyContent: 'center',
      minWidth: 32,
      paddingInline: 10,
      transitionProperty: 'background-color, color, box-shadow',
      '[data-disabled]': {
        opacity: 0.5,
      },
      '[data-pressed=true]': {
        backgroundColor: '#0a0a0a',
        boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
        color: '#ffffff',
      },
      ':disabled': {
        pointerEvents: 'none',
      },
      ':focus-visible': {
        outlineColor: '#a3a3a3',
        outlineOffset: 2,
        outlineStyle: 'solid',
        outlineWidth: 2,
      },
      ':hover': {
        backgroundColor: '#f5f5f5',
      },
    },
    item: {
      display: 'inline-flex',
      '[data-disabled]': {
        cursor: 'not-allowed',
        opacity: 0.5,
      },
    },
    root: {
      alignItems: 'center',
      backgroundColor: '#ffffff',
      borderColor: '#e5e5e5',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
      color: '#0a0a0a',
      columnGap: 4,
      display: 'inline-flex',
      padding: 4,
      '[data-disabled]': {
        opacity: 0.5,
      },
      '[data-orientation=vertical]': {
        flexDirection: 'column',
        rowGap: 4,
      },
    },
  },
  { namespace: 'toolbar', source: 'toolbar.tsx' },
);

export const toolbarClasses = [style.attrs(toolbarStyles.root).class ?? ''] as const;
export const toolbarItemClasses = [style.attrs(toolbarStyles.item).class ?? ''] as const;
export const toolbarButtonClasses = [style.attrs(toolbarStyles.button).class ?? ''] as const;

export const Toolbar = component({
  render(props: ToolbarProps) {
    const attrs = toolbarRootAttributes({
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
    });

    const styleAttrs = style.attrs(toolbarStyles.root, props.styles?.root);

    return (
      <div
        {...styleAttrs}
        aria-describedby={attrs['aria-describedby']}
        aria-disabled={attrs['aria-disabled']}
        aria-label={attrs['aria-label']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-orientation={attrs['aria-orientation']}
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

export const ToolbarItem = component({
  render(props: ToolbarItemProps) {
    const attrs = toolbarItemAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      itemValue: props.itemValue,
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
    });

    const styleAttrs = style.attrs(toolbarStyles.item, props.styles?.item);

    return (
      <span
        {...styleAttrs}
        data-disabled={attrs['data-disabled']}
        id={attrs.id}
      >
        {props.children}
      </span>
    );
  },
});

export const ToolbarButton = component({
  render(props: ToolbarButtonProps) {
    const attrs = toolbarButtonAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      itemValue: props.itemValue,
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.pressed === undefined ? {} : { pressed: props.pressed }),
    });

    const styleAttrs = style.attrs(toolbarStyles.button, props.styles?.button);

    return (
      <button
        {...styleAttrs}
        aria-pressed={attrs['aria-pressed']}
        data-disabled={attrs['data-disabled']}
        data-pressed={attrs['data-pressed']}
        disabled={attrs.disabled}
        id={attrs.id}
        tabIndex={attrs.tabIndex}
        type={attrs.type}
        value={attrs.value}
      >
        {props.children}
      </button>
    );
  },
});
