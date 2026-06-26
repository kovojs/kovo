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

/**
 * Shared state props for the collapsible component family.
 *
 * @example
 * import type { CollapsibleStateProps } from "@kovojs/ui/collapsible";
 * const state: CollapsibleStateProps = {};
 */
export interface CollapsibleStateProps {
  disabled?: boolean;
  open?: boolean;
}

/**
 * Style override slots accepted by the collapsible components.
 *
 * @example
 * import type { CollapsibleStyleOverrides } from "@kovojs/ui/collapsible";
 * const styles: CollapsibleStyleOverrides = {};
 */
export interface CollapsibleStyleOverrides {
  content?: style.StyleInput;
  root?: style.StyleInput;
  trigger?: style.StyleInput;
}

/**
 * Props for the collapsible component.
 *
 * @example
 * import type { CollapsibleProps } from "@kovojs/ui/collapsible";
 * const props: CollapsibleProps = { children: 'Content' };
 */
export interface CollapsibleProps extends CollapsibleStateProps {
  children?: string;
  id?: string;
  styles?: CollapsibleStyleOverrides;
}

/**
 * Props for the collapsible trigger component.
 *
 * @example
 * import type { CollapsibleTriggerProps } from "@kovojs/ui/collapsible";
 * const props: CollapsibleTriggerProps = { children: 'Content' };
 */
export interface CollapsibleTriggerProps extends CollapsibleStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  styles?: CollapsibleStyleOverrides;
}

/**
 * Props for the collapsible content component.
 *
 * @example
 * import type { CollapsibleContentProps } from "@kovojs/ui/collapsible";
 * const props: CollapsibleContentProps = { children: 'Content' };
 */
export interface CollapsibleContentProps extends CollapsibleStateProps {
  children?: string;
  contentId?: string;
  styles?: CollapsibleStyleOverrides;
}

/**
 * Style definitions used by the collapsible components.
 *
 * @example
 * import { collapsibleStyles } from "@kovojs/ui/collapsible";
 * const styles = collapsibleStyles;
 */
export const collapsibleStyles = style.create({
  // Grid wrapper animates open/close via grid-template-rows 0fr<->1fr. The author
  // `display:grid` overrides both the UA `details:not([open]) > *{display:none}`
  // rule and the closed state, so the panel smoothly expands/collapses instead of
  // snapping. data-state comes from the reactive data-bind stamp forwarded via
  // passThroughProps (the reveal fix), so the transition fires client-side.
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
    paddingBottom: 12,
    paddingInline: 12,
    '[data-state=closed]': {
      paddingBottom: 0,
    },
  },
  root: {
    backgroundColor: uiTheme.color.background,
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

function collapsibleState(props: CollapsibleStateProps) {
  return {
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    open: props.open === true,
  };
}

/**
 * Renders the styled collapsible primitive.
 *
 * @example
 * import { Collapsible } from "@kovojs/ui/collapsible";
 * const component = Collapsible;
 */
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

/**
 * Renders the styled collapsible trigger primitive.
 *
 * @example
 * import { CollapsibleTrigger } from "@kovojs/ui/collapsible";
 * const component = CollapsibleTrigger;
 */
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

/**
 * Renders the styled collapsible content primitive.
 *
 * @example
 * import { CollapsibleContent } from "@kovojs/ui/collapsible";
 * const component = CollapsibleContent;
 */
export const CollapsibleContent = component({
  render(props: CollapsibleContentProps) {
    const attrs = collapsibleContentAttributes({
      ...collapsibleState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });
    const styleAttrs = style.attrs(collapsibleStyles.content, props.styles?.content);
    const innerStyleAttrs = style.attrs(collapsibleStyles.contentInner);

    return (
      // passThroughProps forwards the compiler-emitted data-bind:* reactive stamps
      // (e.g. data-bind:data-state) so the panel re-renders open/closed client-side;
      // without it the SSR value stays frozen and the content never reveals.
      // Outer div is the animatable grid wrapper; the inner div holds the padded
      // content and mirrors data-state so its padding collapses with the row.
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        data-state={attrs['data-state']}
        id={attrs.id}
      >
        <div {...innerStyleAttrs} data-state={attrs['data-state']}>
          {props.children}
        </div>
      </div>
    );
  },
});
