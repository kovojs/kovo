/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  toggleGroupButtonAttributes,
  toggleGroupItemAttributes,
  toggleGroupRootAttributes,
  type ToggleGroupItem as HeadlessToggleGroupItem,
  type ToggleGroupType,
  type ToggleGroupValue,
} from '@kovojs/headless-ui/toggle-group';
import type { CollectionOrientation, TextDirection } from '@kovojs/headless-ui';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface ToggleGroupStyleOverrides {
  button?: style.StyleInput;
  item?: style.StyleInput;
  root?: style.StyleInput;
}

export interface ToggleGroupStateProps {
  activeValue?: string;
  collapsible?: boolean;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly HeadlessToggleGroupItem[];
  loop?: boolean;
  orientation?: CollectionOrientation;
  type?: ToggleGroupType;
  value?: ToggleGroupValue;
}

export interface ToggleGroupProps extends ToggleGroupStateProps {
  children?: string;
  descriptionId?: string;
  id?: string;
  labelledBy?: string;
  styles?: ToggleGroupStyleOverrides;
}

export interface ToggleGroupItemProps extends ToggleGroupStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: ToggleGroupStyleOverrides;
}

export interface ToggleGroupButtonProps extends ToggleGroupStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: ToggleGroupStyleOverrides;
}

export const toggleGroupStyles = style.create(
  {
    button: {
      alignItems: 'center',
      borderRadius: 4,
      color: uiTheme.color.foregroundMuted,
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
      '[data-state=pressed]': {
        backgroundColor: uiTheme.color.background,
        boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
        color: uiTheme.color.foreground,
      },
      ':disabled': {
        pointerEvents: 'none',
      },
      ':focus-visible': {
        outlineColor: uiTheme.color.borderStrong,
        outlineOffset: 2,
        outlineStyle: 'solid',
        outlineWidth: 2,
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
      backgroundColor: uiTheme.color.backgroundSubtle,
      borderColor: uiTheme.color.border,
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      color: uiTheme.color.foreground,
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
  { namespace: 'toggleGroup', source: 'toggle-group.tsx' },
);

export const toggleGroupClasses = [style.attrs(toggleGroupStyles.root).class ?? ''] as const;
export const toggleGroupItemClasses = [style.attrs(toggleGroupStyles.item).class ?? ''] as const;
export const toggleGroupButtonClasses = [
  style.attrs(toggleGroupStyles.button).class ?? '',
] as const;

export const ToggleGroup = component({
  render(props: ToggleGroupProps) {
    const attrs = toggleGroupRootAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.collapsible === undefined ? {} : { collapsible: props.collapsible }),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.type === undefined ? {} : { type: props.type }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    const styleAttrs = style.attrs(toggleGroupStyles.root, props.styles?.root);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-describedby={attrs['aria-describedby']}
        aria-disabled={attrs['aria-disabled']}
        aria-labelledby={attrs['aria-labelledby']}
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

export const ToggleGroupItem = component({
  render(props: ToggleGroupItemProps) {
    const attrs = toggleGroupItemAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.collapsible === undefined ? {} : { collapsible: props.collapsible }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      itemValue: props.itemValue,
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.type === undefined ? {} : { type: props.type }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    const styleAttrs = style.attrs(toggleGroupStyles.item, props.styles?.item);

    return (
      <span
        {...styleAttrs}
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={attrs.id}
      >
        {props.children}
      </span>
    );
  },
});

export const ToggleGroupButton = component({
  render(props: ToggleGroupButtonProps) {
    const attrs = toggleGroupButtonAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.collapsible === undefined ? {} : { collapsible: props.collapsible }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      itemValue: props.itemValue,
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.type === undefined ? {} : { type: props.type }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    const styleAttrs = style.attrs(toggleGroupStyles.button, props.styles?.button);

    return (
      <button
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-pressed={attrs['aria-pressed']}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
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
