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
import * as style from '@kovojs/style';

import type { CollectionOrientation, TextDirection } from './navigation-types.js';
import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

/**
 * Style override slots accepted by the toggle group components.
 *
 * @example
 * import type { ToggleGroupStyleOverrides } from "@kovojs/ui/toggle-group";
 * const styles: ToggleGroupStyleOverrides = {};
 */
export interface ToggleGroupStyleOverrides {
  button?: style.StyleInput;
  item?: style.StyleInput;
  root?: style.StyleInput;
}

/**
 * Shared state props for the toggle group component family.
 *
 * @example
 * import type { ToggleGroupStateProps } from "@kovojs/ui/toggle-group";
 * const state: ToggleGroupStateProps = {};
 */
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

/**
 * Props for the toggle group component.
 *
 * @example
 * import type { ToggleGroupProps } from "@kovojs/ui/toggle-group";
 * const props: ToggleGroupProps = { children: 'Content' };
 */
export interface ToggleGroupProps extends ToggleGroupStateProps {
  children?: string;
  descriptionId?: string;
  id?: string;
  labelledBy?: string;
  styles?: ToggleGroupStyleOverrides;
}

/**
 * Props for the toggle group item component.
 *
 * @example
 * import type { ToggleGroupItemProps } from "@kovojs/ui/toggle-group";
 * const props: ToggleGroupItemProps = { itemValue: 'item', children: 'Content' };
 */
export interface ToggleGroupItemProps extends ToggleGroupStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: ToggleGroupStyleOverrides;
}

/**
 * Props for the toggle group button component.
 *
 * @example
 * import type { ToggleGroupButtonProps } from "@kovojs/ui/toggle-group";
 * const props: ToggleGroupButtonProps = { itemValue: 'item', children: 'Content' };
 */
export interface ToggleGroupButtonProps extends ToggleGroupStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: ToggleGroupStyleOverrides;
}

/**
 * Style definitions used by the toggle group components.
 *
 * @example
 * import { toggleGroupStyles } from "@kovojs/ui/toggle-group";
 * const styles = toggleGroupStyles;
 */
export const toggleGroupStyles = style.create({
  button: {
    // Button reset: kill the native UA <button> bevel so items read as a flat
    // segmented control (mirrors select.tsx's clean option rows).
    alignItems: 'center',
    appearance: 'none',
    backgroundColor: 'transparent',
    borderRadius: 4,
    borderStyle: 'none',
    borderWidth: 0,
    color: uiTheme.color.foregroundMuted,
    cursor: 'pointer',
    display: 'inline-flex',
    fontFamily: 'inherit',
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
      outlineColor: uiTheme.color.accent,
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
});

/**
 * Renders the styled toggle group primitive.
 *
 * @example
 * import { ToggleGroup } from "@kovojs/ui/toggle-group";
 * const component = ToggleGroup;
 */
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

/**
 * Renders the styled toggle group item primitive.
 *
 * @example
 * import { ToggleGroupItem } from "@kovojs/ui/toggle-group";
 * const component = ToggleGroupItem;
 */
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

/**
 * Renders the styled toggle group button primitive.
 *
 * @example
 * import { ToggleGroupButton } from "@kovojs/ui/toggle-group";
 * const component = ToggleGroupButton;
 */
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
