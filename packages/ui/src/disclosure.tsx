/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  disclosureContentAttributes,
  disclosureRootAttributes,
  disclosureTriggerAttributes,
} from '@kovojs/headless-ui/disclosure';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface DisclosureStateProps {
  disabled?: boolean;
  open?: boolean;
}

export interface DisclosureStyleOverrides {
  content?: style.StyleInput;
  root?: style.StyleInput;
  trigger?: style.StyleInput;
}

export interface DisclosureProps extends DisclosureStateProps {
  children?: string;
  id?: string;
  styles?: DisclosureStyleOverrides;
}

export interface DisclosureTriggerProps extends DisclosureStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  styles?: DisclosureStyleOverrides;
}

export interface DisclosureContentProps extends DisclosureStateProps {
  children?: string;
  contentId?: string;
  styles?: DisclosureStyleOverrides;
}

export const disclosureStyles = style.create({
  // Grid wrapper animates open/close via grid-template-rows 0fr<->1fr. The author
  // `display:grid` overrides the UA `[hidden]{display:none}` so the panel can
  // transition while `hidden` stays true (correct a11y + gallery contract).
  // data-state comes from the reactive data-bind stamp forwarded via
  // passThroughProps (the reveal fix).
  content: {
    backgroundColor: uiTheme.color.background,
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
    padding: 12,
    '[data-state=closed]': {
      paddingBottom: 0,
      paddingTop: 0,
    },
  },
  root: {
    color: uiTheme.color.foreground,
    display: 'grid',
    fontSize: 14,
    rowGap: 8,
    '[data-disabled]': {
      opacity: 0.5,
    },
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    color: uiTheme.color.foreground,
    display: 'inline-flex',
    fontSize: 14,
    fontWeight: 500,
    height: 36,
    justifyContent: 'center',
    paddingInline: 12,
    transitionProperty: 'background-color',
    width: 'fit-content',
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
    '[data-state=open]': {
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
    },
    '[data-state=open]::after': {
      transform: 'rotate(-135deg)',
    },
    ':disabled': {
      opacity: 0.5,
      pointerEvents: 'none',
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
    ':hover': {
      backgroundColor: uiTheme.color.backgroundRaised,
    },
  },
});

function disclosureState(props: DisclosureStateProps) {
  return {
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    open: props.open === true,
  };
}

export const Disclosure = component({
  render(props: DisclosureProps) {
    const attrs = disclosureRootAttributes(disclosureState(props));
    const styleAttrs = style.attrs(disclosureStyles.root, props.styles?.root);

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

export const DisclosureTrigger = component({
  render(props: DisclosureTriggerProps) {
    const attrs = disclosureTriggerAttributes({
      ...disclosureState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });
    const styleAttrs = style.attrs(disclosureStyles.trigger, props.styles?.trigger);

    return (
      <button
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        {...styleAttrs}
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        id={props.id}
        type={attrs.type}
      >
        {props.children}
      </button>
    );
  },
});

export const DisclosureContent = component({
  render(props: DisclosureContentProps) {
    const attrs = disclosureContentAttributes({
      ...disclosureState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });
    const styleAttrs = style.attrs(disclosureStyles.content, props.styles?.content);
    const innerStyleAttrs = style.attrs(disclosureStyles.contentInner);

    return (
      // passThroughProps forwards the compiler-emitted data-bind:* reactive stamps
      // (data-bind:data-state / data-bind:hidden) so the panel reveals client-side;
      // without it the SSR closed value stays frozen and clicking does nothing.
      // Outer div is the animatable grid wrapper and keeps the hidden/id/data-state
      // contract; the inner div holds the padded content and collapses with the row.
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
      >
        <div {...innerStyleAttrs} data-state={attrs['data-state']}>
          {props.children}
        </div>
      </div>
    );
  },
});
