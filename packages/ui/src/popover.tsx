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

/**
 * Style override slots accepted by the popover components.
 *
 * @example
 * import type { PopoverStyleOverrides } from "@kovojs/ui/popover";
 * const styles: PopoverStyleOverrides = {};
 */
export interface PopoverStyleOverrides {
  content?: style.StyleInput;
  root?: style.StyleInput;
  trigger?: style.StyleInput;
}

/**
 * Shared state props for the popover component family.
 *
 * @example
 * import type { PopoverStateProps } from "@kovojs/ui/popover";
 * const state: PopoverStateProps = {};
 */
export interface PopoverStateProps {
  disabled?: boolean;
  open?: boolean;
}

/**
 * Props for the popover component.
 *
 * @example
 * import type { PopoverProps } from "@kovojs/ui/popover";
 * const props: PopoverProps = { children: 'Content' };
 */
export interface PopoverProps extends PopoverStateProps {
  children?: string;
  id?: string;
  styles?: PopoverStyleOverrides;
}

/**
 * Props for the popover trigger component.
 *
 * @example
 * import type { PopoverTriggerProps } from "@kovojs/ui/popover";
 * const props: PopoverTriggerProps = { children: 'Content' };
 */
export interface PopoverTriggerProps extends PopoverStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  styles?: PopoverStyleOverrides;
}

/**
 * Props for the popover content component.
 *
 * @example
 * import type { PopoverContentProps } from "@kovojs/ui/popover";
 * const props: PopoverContentProps = { children: 'Content' };
 */
export interface PopoverContentProps extends PopoverStateProps {
  children?: string;
  contentId?: string;
  styles?: PopoverStyleOverrides;
}

/**
 * Style definitions used by the popover components.
 *
 * @example
 * import { popoverStyles } from "@kovojs/ui/popover";
 * const styles = popoverStyles;
 */
export const popoverStyles = style.create({
  content: {
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    color: uiTheme.color.foreground,
    fontSize: 14,
    // SPEC.md §5.2 / better-components-ux: the native popover is promoted to the
    // top layer where position:absolute no longer resolves against the relative
    // root and the UA [popover]:popover-open rule (inset:0;margin:auto) would
    // center it on screen. CSS anchor positioning re-anchors it to the trigger:
    // override the UA centering with inset:auto + margin:0, then place the box in
    // the bottom-right area of the trigger anchor. A 6px gap is added via the top
    // margin (margins are honored inside the position-area).
    inset: 'auto',
    margin: 0,
    marginTop: 6,
    padding: 12,
    position: 'absolute',
    positionAnchor: '--kovo-popover-anchor',
    positionArea: 'bottom span-right',
    width: 256,
    zIndex: 50,
    '[data-state=closed]': {
      display: 'none',
    },
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
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
    // Anchor target for the top-layer PopoverContent (see content rule).
    anchorName: '--kovo-popover-anchor',
    appearance: 'none',
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
    color: uiTheme.color.foreground,
    display: 'inline-flex',
    font: 'inherit',
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

function popoverState(props: PopoverStateProps) {
  return {
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    open: props.open === true,
  };
}

/**
 * Renders the styled popover primitive.
 *
 * @example
 * import { Popover } from "@kovojs/ui/popover";
 * const component = Popover;
 */
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

/**
 * Renders the styled popover trigger primitive.
 *
 * @example
 * import { PopoverTrigger } from "@kovojs/ui/popover";
 * const component = PopoverTrigger;
 */
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

/**
 * Renders the styled popover content primitive.
 *
 * @example
 * import { PopoverContent } from "@kovojs/ui/popover";
 * const component = PopoverContent;
 */
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
