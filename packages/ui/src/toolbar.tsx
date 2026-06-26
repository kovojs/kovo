/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  toolbarButtonAttributes,
  toolbarItemAttributes,
  toolbarRootAttributes,
  type ToolbarItem as HeadlessToolbarItem,
  type ToolbarOrientation,
} from '@kovojs/headless-ui/toolbar';
import * as style from '@kovojs/style';

import type { TextDirection } from './navigation-types.js';
import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

/**
 * Style override slots accepted by the toolbar components.
 *
 * @example
 * import type { ToolbarStyleOverrides } from "@kovojs/ui/toolbar";
 * const styles: ToolbarStyleOverrides = {};
 */
export interface ToolbarStyleOverrides {
  button?: style.StyleInput;
  item?: style.StyleInput;
  root?: style.StyleInput;
}

/**
 * Shared state props for the toolbar component family.
 *
 * @example
 * import type { ToolbarStateProps } from "@kovojs/ui/toolbar";
 * const state: ToolbarStateProps = {};
 */
export interface ToolbarStateProps {
  activeValue?: string;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly HeadlessToolbarItem[];
  loop?: boolean;
  orientation?: ToolbarOrientation;
}

/**
 * Props for the toolbar component.
 *
 * @example
 * import type { ToolbarProps } from "@kovojs/ui/toolbar";
 * const props: ToolbarProps = { children: 'Content' };
 */
export interface ToolbarProps extends ToolbarStateProps {
  children?: string;
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
  styles?: ToolbarStyleOverrides;
}

/**
 * Props for the toolbar item component.
 *
 * @example
 * import type { ToolbarItemProps } from "@kovojs/ui/toolbar";
 * const props: ToolbarItemProps = { itemValue: 'item', children: 'Content' };
 */
export interface ToolbarItemProps extends ToolbarStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: ToolbarStyleOverrides;
}

/**
 * Props for the toolbar button component.
 *
 * @example
 * import type { ToolbarButtonProps } from "@kovojs/ui/toolbar";
 * const props: ToolbarButtonProps = { itemValue: 'item', children: 'Content' };
 */
export interface ToolbarButtonProps extends ToolbarItemProps {
  pressed?: boolean;
}

/**
 * Style definitions used by the toolbar components.
 *
 * @example
 * import { toolbarStyles } from "@kovojs/ui/toolbar";
 * const styles = toolbarStyles;
 */
export const toolbarStyles = style.create({
  button: {
    alignItems: 'center',
    borderRadius: uiTheme.radius.sm,
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
    // shadcn-style toggle "on" state: a subtle muted fill with normal-weight
    // foreground (not a heavy inverted/near-black fill, which reads as a separate
    // primary button rather than a pressed tool).
    '[data-pressed=true]': {
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
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
    ':hover': {
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
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
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
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
 * Renders the styled toolbar primitive.
 *
 * @example
 * import { Toolbar } from "@kovojs/ui/toolbar";
 * const component = Toolbar;
 */
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
        {...passThroughProps(props)}
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

/**
 * Renders the styled toolbar item primitive.
 *
 * @example
 * import { ToolbarItem } from "@kovojs/ui/toolbar";
 * const component = ToolbarItem;
 */
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
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        id={attrs.id}
      >
        {props.children}
      </span>
    );
  },
});

/**
 * Renders the styled toolbar button primitive.
 *
 * @example
 * import { ToolbarButton } from "@kovojs/ui/toolbar";
 * const component = ToolbarButton;
 */
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
        {...passThroughProps(props)}
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
