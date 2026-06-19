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

export const disclosureStyles = style.create(
  {
    content: {
      backgroundColor: uiTheme.color.background,
      borderColor: uiTheme.color.border,
      borderRadius: uiTheme.radius.md,
      borderStyle: 'solid',
      borderWidth: 1,
      color: uiTheme.color.foregroundMuted,
      fontSize: 14,
      padding: 12,
      '[data-state=closed]': {
        display: 'none',
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
      borderColor: uiTheme.color.borderStrong,
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
  { namespace: 'disclosure', source: 'disclosure.tsx' },
);

export const disclosureClasses = [style.attrs(disclosureStyles.root).class ?? ''] as const;
export const disclosureTriggerClasses = [
  style.attrs(disclosureStyles.trigger).class ?? '',
] as const;
export const disclosureContentClasses = [
  style.attrs(disclosureStyles.content).class ?? '',
] as const;

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

    return (
      <div {...styleAttrs} data-state={attrs['data-state']} hidden={attrs.hidden} id={attrs.id}>
        {props.children}
      </div>
    );
  },
});

export * from '@kovojs/headless-ui/disclosure';
