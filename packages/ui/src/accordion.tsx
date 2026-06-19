/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  accordionContentAttributes,
  accordionHeaderAttributes,
  accordionItemAttributes,
  accordionRootAttributes,
  accordionTriggerAttributes,
  type AccordionType,
  type AccordionValue,
} from '@kovojs/headless-ui/accordion';
import * as style from '@kovojs/style';

import type { CollectionOrientation } from './navigation-types.js';
import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface AccordionStyleOverrides {
  content?: style.StyleInput;
  header?: style.StyleInput;
  item?: style.StyleInput;
  root?: style.StyleInput;
  trigger?: style.StyleInput;
}

export interface AccordionStateProps {
  collapsible?: boolean;
  disabled?: boolean;
  orientation?: CollectionOrientation;
  type?: AccordionType;
  value?: AccordionValue;
}

export interface AccordionProps extends AccordionStateProps {
  children?: string;
  id?: string;
  styles?: AccordionStyleOverrides;
}

export interface AccordionItemProps extends AccordionStateProps {
  children?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: AccordionStyleOverrides;
}

export interface AccordionHeaderProps extends AccordionItemProps {
  level?: number;
}

export interface AccordionTriggerProps extends AccordionItemProps {
  contentId?: string;
  triggerId?: string;
}

export interface AccordionContentProps extends AccordionItemProps {
  contentId?: string;
  triggerId?: string;
}

export const accordionStyles = style.create(
  {
    content: {
      color: uiTheme.color.foregroundMuted,
      fontSize: 14,
      paddingBottom: 12,
      paddingInline: 12,
      paddingTop: 4,
      '[data-state=closed]': {
        display: 'none',
      },
    },
    header: {
      fontSize: 14,
      fontWeight: 500,
      margin: 0,
    },
    item: {
      backgroundColor: uiTheme.color.background,
      borderColor: uiTheme.color.border,
      borderRadius: uiTheme.radius.md,
      borderStyle: 'solid',
      borderWidth: 1,
      '[data-disabled]': {
        opacity: 0.5,
      },
    },
    root: {
      color: uiTheme.color.foreground,
      display: 'grid',
      fontSize: 14,
      rowGap: 8,
      width: '100%',
      '[data-disabled]': {
        opacity: 0.5,
      },
    },
    trigger: {
      alignItems: 'center',
      borderRadius: uiTheme.radius.md,
      color: uiTheme.color.foreground,
      display: 'flex',
      fontSize: 14,
      fontWeight: 500,
      justifyContent: 'space-between',
      paddingBlock: 8,
      paddingInline: 12,
      textAlign: 'left',
      transitionProperty: 'background-color, color',
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
      '[data-disabled]': {
        opacity: 0.5,
      },
      '[data-state=open]': {
        backgroundColor: uiTheme.color.backgroundRaised,
      },
      '[data-state=open]::after': {
        transform: 'rotate(-135deg)',
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
      ':hover': {
        backgroundColor: uiTheme.color.backgroundRaised,
      },
    },
  },
);

export const accordionClasses = [style.attrs(accordionStyles.root).class ?? ''] as const;
export const accordionItemClasses = [style.attrs(accordionStyles.item).class ?? ''] as const;
export const accordionHeaderClasses = [style.attrs(accordionStyles.header).class ?? ''] as const;
export const accordionTriggerClasses = [style.attrs(accordionStyles.trigger).class ?? ''] as const;
export const accordionContentClasses = [style.attrs(accordionStyles.content).class ?? ''] as const;

function accordionState(props: AccordionStateProps) {
  return {
    ...(props.collapsible === undefined ? {} : { collapsible: props.collapsible }),
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
    ...(props.type === undefined ? {} : { type: props.type }),
    ...(props.value === undefined ? {} : { value: props.value }),
  };
}

function accordionItemState(props: AccordionItemProps) {
  return {
    ...accordionState(props),
    ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
    itemValue: props.itemValue,
  };
}

export const Accordion = component({
  render(props: AccordionProps) {
    const attrs = accordionRootAttributes(accordionState(props));
    const styleAttrs = style.attrs(accordionStyles.root, props.styles?.root);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        data-orientation={attrs['data-orientation']}
        id={props.id}
      >
        {props.children}
      </div>
    );
  },
});

export const AccordionItem = component({
  render(props: AccordionItemProps) {
    const attrs = accordionItemAttributes(accordionItemState(props));
    const styleAttrs = style.attrs(accordionStyles.item, props.styles?.item);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        open={attrs.open}
      >
        {props.children}
      </div>
    );
  },
});

export const AccordionHeader = component({
  render(props: AccordionHeaderProps) {
    const attrs = accordionHeaderAttributes({
      ...accordionItemState(props),
      ...(props.level === undefined ? {} : { level: props.level }),
    });
    const styleAttrs = style.attrs(accordionStyles.header, props.styles?.header);

    return (
      <h3
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-level={attrs['aria-level']}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        role={attrs.role}
      >
        {props.children}
      </h3>
    );
  },
});

export const AccordionTrigger = component({
  render(props: AccordionTriggerProps) {
    const attrs = accordionTriggerAttributes({
      ...accordionItemState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.triggerId === undefined ? {} : { triggerId: props.triggerId }),
    });
    const styleAttrs = style.attrs(accordionStyles.trigger, props.styles?.trigger);

    return (
      <button
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
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

export const AccordionContent = component({
  render(props: AccordionContentProps) {
    const attrs = accordionContentAttributes({
      ...accordionItemState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.triggerId === undefined ? {} : { triggerId: props.triggerId }),
    });
    const styleAttrs = style.attrs(accordionStyles.content, props.styles?.content);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-labelledby={attrs['aria-labelledby']}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
        role={attrs.role}
      >
        {props.children}
      </div>
    );
  },
});
