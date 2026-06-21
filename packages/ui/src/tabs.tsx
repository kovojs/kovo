/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  tabsListAttributes,
  tabsPanelAttributes,
  tabsRootAttributes,
  tabsTriggerAttributes,
  type TabsActivationMode,
  type TabsItem,
} from '@kovojs/headless-ui/tabs';
import * as style from '@kovojs/style';

import type { CollectionOrientation, TextDirection } from './navigation-types.js';
import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface TabsStyleOverrides {
  list?: style.StyleInput;
  panel?: style.StyleInput;
  root?: style.StyleInput;
  trigger?: style.StyleInput;
}

export interface TabsStateProps {
  activationMode?: TabsActivationMode;
  activeValue?: string;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly TabsItem[];
  loop?: boolean;
  orientation?: CollectionOrientation;
  value?: string;
}

export interface TabsProps extends TabsStateProps {
  children?: string;
  id?: string;
  styles?: TabsStyleOverrides;
}

export interface TabsListProps extends TabsStateProps {
  children?: string;
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
  styles?: TabsStyleOverrides;
}

export interface TabsTriggerProps extends TabsStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  panelId?: string;
  styles?: TabsStyleOverrides;
}

export interface TabsPanelProps extends TabsStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: TabsStyleOverrides;
  triggerId?: string;
}

// Fade the active panel in on switch. The `style.keyframes` name is resolved by
// the StyleX extractor, which emits the `@keyframes` block into the served CSS
// (SPEC.md §13.1).
const panelFade = style.keyframes(
  {
    '0%': { opacity: 0 },
    '100%': { opacity: 1 },
  },
  { namespace: 'tabsPanelFade', source: 'tabs.tsx' },
);

export const tabsStyles = style.create({
  list: {
    alignItems: 'center',
    backgroundColor: uiTheme.color.backgroundSubtleHigh,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    columnGap: 4,
    display: 'inline-flex',
    height: 40,
    padding: 4,
    '[data-disabled]': {
      opacity: 0.5,
    },
    '[data-orientation=vertical]': {
      flexDirection: 'column',
      height: 'auto',
      rowGap: 4,
    },
  },
  panel: {
    animationDuration: '0.15s',
    animationName: panelFade,
    animationTimingFunction: 'ease-out',
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    color: uiTheme.color.foregroundMuted,
    fontSize: 14,
    marginTop: 12,
    padding: 16,
    '[data-state=inactive]': {
      display: 'none',
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
  },
  root: {
    color: uiTheme.color.foreground,
    width: '100%',
    '[data-disabled]': {
      opacity: 0.5,
    },
  },
  trigger: {
    alignItems: 'center',
    appearance: 'none',
    backgroundColor: 'transparent',
    borderRadius: uiTheme.radius.sm,
    borderStyle: 'none',
    color: uiTheme.color.foregroundMuted,
    cursor: 'pointer',
    display: 'inline-flex',
    fontSize: 14,
    fontWeight: 500,
    height: 32,
    justifyContent: 'center',
    paddingInline: 12,
    transitionProperty: 'background-color, color, box-shadow',
    '[data-disabled]': {
      opacity: 0.5,
    },
    '[data-state=active]': {
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
});

export const Tabs = component({
  render(props: TabsProps) {
    const attrs = tabsRootAttributes({
      ...(props.activationMode === undefined ? {} : { activationMode: props.activationMode }),
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const styleAttrs = style.attrs(tabsStyles.root, props.styles?.root);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        data-orientation={attrs['data-orientation']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

export const TabsList = component({
  render(props: TabsListProps) {
    const attrs = tabsListAttributes({
      ...(props.activationMode === undefined ? {} : { activationMode: props.activationMode }),
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
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const styleAttrs = style.attrs(tabsStyles.list, props.styles?.list);

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

export const TabsTrigger = component({
  render(props: TabsTriggerProps) {
    const attrs = tabsTriggerAttributes({
      ...(props.activationMode === undefined ? {} : { activationMode: props.activationMode }),
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.items === undefined ? {} : { items: props.items }),
      itemValue: props.itemValue,
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.panelId === undefined ? {} : { panelId: props.panelId }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const styleAttrs = style.attrs(tabsStyles.trigger, props.styles?.trigger);

    return (
      <button
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-controls={attrs['aria-controls']}
        aria-selected={attrs['aria-selected']}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        id={attrs.id}
        role={attrs.role}
        tabIndex={attrs.tabIndex}
        type={attrs.type}
        value={attrs.value}
      >
        {props.children}
      </button>
    );
  },
});

export const TabsPanel = component({
  render(props: TabsPanelProps) {
    const attrs = tabsPanelAttributes({
      ...(props.activationMode === undefined ? {} : { activationMode: props.activationMode }),
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.items === undefined ? {} : { items: props.items }),
      itemValue: props.itemValue,
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.triggerId === undefined ? {} : { triggerId: props.triggerId }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const styleAttrs = style.attrs(tabsStyles.panel, props.styles?.panel);

    return (
      <section
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-labelledby={attrs['aria-labelledby']}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
        role={attrs.role}
        tabIndex={attrs.tabIndex}
      >
        {props.children}
      </section>
    );
  },
});
