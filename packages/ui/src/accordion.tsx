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

export const accordionStyles = style.create({
  // Outer grid wrapper animates open/close via grid-template-rows 0fr<->1fr
  // (SPEC complaint #9: panel should smoothly animate height). The inner
  // `contentInner` owns padding/min-height:0; this div carries no padding so the
  // collapsed 0fr row leaves zero height. data-state is driven by the reactive
  // data-bind stamp forwarded through passThroughProps, so the transition fires
  // client-side. Falls back to discrete display:none for reduced-motion users.
  content: {
    display: 'grid',
    gridTemplateRows: '1fr',
    transitionDuration: '200ms',
    transitionProperty: 'grid-template-rows',
    transitionTimingFunction: 'ease',
    '[data-state=closed]': {
      gridTemplateRows: '0fr',
    },
    '@media (prefers-reduced-motion: reduce)': {
      transitionProperty: 'none',
    },
  },
  contentInner: {
    color: uiTheme.color.foregroundMuted,
    fontSize: 14,
    minHeight: 0,
    overflow: 'hidden',
    // Padding lives on a nested element so it animates away with the row height;
    // padding on the grid track itself would keep a residual gap when collapsed.
    paddingBottom: 12,
    paddingInline: 12,
    paddingTop: 4,
    '[data-state=closed]': {
      paddingBottom: 0,
      paddingTop: 0,
    },
  },
  header: {
    fontSize: 14,
    fontWeight: 500,
    margin: 0,
  },
  item: {
    backgroundColor: uiTheme.color.background,
    borderBottomColor: uiTheme.color.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
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
    // Transparent borderless button so the de-boxed accordion reads as flat rows
    // (otherwise the native <button> chrome — gray fill + bevel — shows through).
    backgroundColor: 'transparent',
    borderRadius: uiTheme.radius.md,
    borderStyle: 'none',
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
    '[data-state=open]::after': {
      transform: 'rotate(-135deg)',
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
      textDecoration: 'underline',
    },
  },
});

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
    const innerStyleAttrs = style.attrs(accordionStyles.contentInner);

    return (
      // Outer div is the grid wrapper that animates height; it keeps the id/role/
      // aria-labelledby/data-state/hidden contract and forwards the reactive
      // data-bind stamps via passThroughProps. The inner div carries the padded
      // content and mirrors data-state so its padding collapses with the row.
      // `hidden` stays on this element for a11y + the gallery contract: the closed
      // panel is correctly removed from the accessibility tree. The StyleX
      // `display:grid` (author rule) overrides the UA `[hidden]{display:none}`, so
      // the grid-rows 0fr<->1fr transition still fires while `hidden` stays true.
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
        <div {...innerStyleAttrs} data-state={attrs['data-state']}>
          {props.children}
        </div>
      </div>
    );
  },
});
