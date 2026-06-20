/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  collapsibleContentAttributes,
  collapsibleRootAttributes,
  collapsibleTriggerAttributes,
} from '@kovojs/headless-ui/collapsible';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface CollapsibleStateProps {
  disabled?: boolean;
  open?: boolean;
}

export interface CollapsibleStyleOverrides {
  content?: style.StyleInput;
  root?: style.StyleInput;
  trigger?: style.StyleInput;
}

export interface CollapsibleProps extends CollapsibleStateProps {
  children?: string;
  id?: string;
  styles?: CollapsibleStyleOverrides;
}

export interface CollapsibleTriggerProps extends CollapsibleStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  styles?: CollapsibleStyleOverrides;
}

export interface CollapsibleContentProps extends CollapsibleStateProps {
  children?: string;
  contentId?: string;
  styles?: CollapsibleStyleOverrides;
}

export const collapsibleStyles = style.create({
  content: {
    color: uiTheme.color.foregroundMuted,
    fontSize: 14,
    paddingBottom: 12,
    paddingInline: 12,
    '[data-state=closed]': {
      display: 'none',
    },
  },
  root: {
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    color: uiTheme.color.foreground,
    fontSize: 14,
    '[data-disabled]': {
      opacity: 0.5,
    },
  },
  trigger: {
    alignItems: 'center',
    color: uiTheme.color.foreground,
    cursor: 'pointer',
    display: 'flex',
    fontWeight: 500,
    justifyContent: 'space-between',
    listStyle: 'none',
    outlineStyle: 'none',
    paddingBlock: 8,
    paddingInline: 12,
    width: '100%',
    '::after': {
      borderColor: uiTheme.color.foregroundMuted,
      borderStyle: 'solid',
      borderWidth: '0 2px 2px 0',
      content: '""',
      flexShrink: 0,
      height: 8,
      marginLeft: 8,
      transform: 'rotate(45deg)',
      transitionProperty: 'transform',
      width: 8,
    },
    '::-webkit-details-marker': {
      display: 'none',
    },
    '[data-disabled]': {
      cursor: 'not-allowed',
      opacity: 0.5,
    },
    '[data-state=open]': {
      backgroundColor: uiTheme.color.backgroundRaised,
    },
    '[data-state=open]::after': {
      transform: 'rotate(-135deg)',
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
  },
});

export const collapsibleClasses = [style.attrs(collapsibleStyles.root).class ?? ''] as const;
export const collapsibleTriggerClasses = [
  style.attrs(collapsibleStyles.trigger).class ?? '',
] as const;
export const collapsibleContentClasses = [
  style.attrs(collapsibleStyles.content).class ?? '',
] as const;

function collapsibleState(props: CollapsibleStateProps) {
  return {
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    open: props.open === true,
  };
}

export const Collapsible = component({
  render(props: CollapsibleProps) {
    const attrs = collapsibleRootAttributes(collapsibleState(props));
    const styleAttrs = style.attrs(collapsibleStyles.root, props.styles?.root);

    return (
      <details
        {...styleAttrs}
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={props.id}
        open={attrs.open}
      >
        {props.children}
      </details>
    );
  },
});

export const CollapsibleTrigger = component({
  render(props: CollapsibleTriggerProps) {
    const attrs = collapsibleTriggerAttributes({
      ...collapsibleState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });
    const styleAttrs = style.attrs(collapsibleStyles.trigger, props.styles?.trigger);

    return (
      <summary
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        {...styleAttrs}
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={props.id}
      >
        {props.children}
      </summary>
    );
  },
});

export const CollapsibleContent = component({
  render(props: CollapsibleContentProps) {
    const attrs = collapsibleContentAttributes({
      ...collapsibleState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });
    const styleAttrs = style.attrs(collapsibleStyles.content, props.styles?.content);

    return (
      <div {...styleAttrs} data-state={attrs['data-state']} id={attrs.id}>
        {props.children}
      </div>
    );
  },
});
