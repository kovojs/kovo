/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  popoverContentAttributes,
  popoverRootAttributes,
  popoverTriggerAttributes,
} from '@kovojs/headless-ui/popover';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface PopoverStyleOverrides {
  content?: style.StyleInput;
  root?: style.StyleInput;
  trigger?: style.StyleInput;
}

export interface PopoverStateProps {
  disabled?: boolean;
  open?: boolean;
}

export interface PopoverProps extends PopoverStateProps {
  children?: string;
  id?: string;
  styles?: PopoverStyleOverrides;
}

export interface PopoverTriggerProps extends PopoverStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  styles?: PopoverStyleOverrides;
}

export interface PopoverContentProps extends PopoverStateProps {
  children?: string;
  contentId?: string;
  styles?: PopoverStyleOverrides;
}

export const popoverStyles = style.create(
  {
    content: {
      backgroundColor: uiTheme.color.background,
      borderColor: uiTheme.color.border,
      borderRadius: uiTheme.radius.md,
      borderStyle: 'solid',
      borderWidth: 1,
      color: uiTheme.color.foregroundMuted,
      fontSize: 14,
      marginTop: 8,
      padding: 12,
      width: 256,
      '[data-state=closed]': {
        display: 'none',
      },
      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
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
      transitionProperty: 'background-color',
      '[data-state=open]': {
        backgroundColor: uiTheme.color.backgroundSubtleHigh,
      },
      ':disabled': {
        opacity: 0.5,
        pointerEvents: 'none',
      },
      ':focus-visible': {
        outlineColor: uiTheme.color.borderStrong,
        outlineOffset: 2,
        outlineStyle: 'solid',
        outlineWidth: 2,
      },
      ':hover': {
        backgroundColor: uiTheme.color.backgroundRaised,
      },
    },
  },
  { namespace: 'popover', source: 'popover.tsx' },
);

export const popoverClasses = [style.attrs(popoverStyles.root).class ?? ''] as const;
export const popoverTriggerClasses = [style.attrs(popoverStyles.trigger).class ?? ''] as const;
export const popoverContentClasses = [style.attrs(popoverStyles.content).class ?? ''] as const;

function popoverState(props: PopoverStateProps) {
  return {
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    open: props.open === true,
  };
}

export const Popover = component({
  render(props: PopoverProps) {
    const attrs = popoverRootAttributes(popoverState(props));
    const styleAttrs = style.attrs(popoverStyles.root, props.styles?.root);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={props.id}
      >
        {props.children}
      </div>
    );
  },
});

export const PopoverTrigger = component({
  render(props: PopoverTriggerProps) {
    const attrs = popoverTriggerAttributes({
      ...popoverState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });
    const styleAttrs = style.attrs(popoverStyles.trigger, props.styles?.trigger);

    return (
      <button
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        id={props.id}
        popovertarget={attrs.popovertarget}
        popovertargetaction={attrs.popovertargetaction}
        type={attrs.type}
      >
        {props.children}
      </button>
    );
  },
});

export const PopoverContent = component({
  render(props: PopoverContentProps) {
    const attrs = popoverContentAttributes({
      ...popoverState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });
    const styleAttrs = style.attrs(popoverStyles.content, props.styles?.content);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        data-state={attrs['data-state']}
        id={attrs.id}
        popover={attrs.popover}
      >
        {props.children}
      </div>
    );
  },
});

export * from '@kovojs/headless-ui/popover';
