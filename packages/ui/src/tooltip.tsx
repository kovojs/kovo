/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  tooltipContentAttributes,
  tooltipRootAttributes,
  tooltipTriggerAttributes,
} from '@kovojs/headless-ui/tooltip';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface TooltipStyleOverrides {
  content?: style.StyleInput;
  root?: style.StyleInput;
  trigger?: style.StyleInput;
}

export interface TooltipStateProps {
  disabled?: boolean;
  open?: boolean;
}

export interface TooltipProps extends TooltipStateProps {
  children?: string;
  id?: string;
  styles?: TooltipStyleOverrides;
}

export interface TooltipTriggerProps extends TooltipStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  styles?: TooltipStyleOverrides;
}

export interface TooltipContentProps extends TooltipStateProps {
  children?: string;
  contentId?: string;
  styles?: TooltipStyleOverrides;
}

export const tooltipStyles = style.create({
  // Rotated-square arrow at the bottom center of the content, pointing down to
  // the trigger. Same fill as the content so the two read as one shape.
  arrow: {
    backgroundColor: uiTheme.color.backgroundInverse,
    borderBottomRightRadius: 2,
    bottom: -3,
    height: 8,
    left: '50%',
    marginLeft: -4,
    position: 'absolute',
    transform: 'rotate(45deg)',
    width: 8,
  },
  content: {
    backgroundColor: uiTheme.color.backgroundInverse,
    borderRadius: uiTheme.radius.md,
    color: uiTheme.color.foregroundInverse,
    fontSize: 12,
    // Center above the trigger relative to the position:relative root. Plain
    // absolute placement (not CSS anchor positioning) so it lands centered above
    // the trigger in every browser instead of falling back to the root's corner.
    bottom: '100%',
    left: '50%',
    marginBottom: 6,
    maxWidth: 256,
    paddingBlock: 6,
    paddingInline: 12,
    position: 'absolute',
    transform: 'translateX(-50%)',
    width: 'max-content',
    zIndex: 50,
    '[data-state=closed]': {
      display: 'none',
    },
    boxShadow: '0 4px 6px -2px rgb(0 0 0 / 0.12)',
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
    // Anchor target for the TooltipContent (see content rule).
    anchorName: '--kovo-tooltip-anchor',
    appearance: 'none',
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.borderStrong,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
    color: uiTheme.color.foreground,
    display: 'inline-flex',
    font: 'inherit',
    fontSize: 14,
    fontWeight: 500,
    height: 32,
    justifyContent: 'center',
    paddingInline: 10,
    transitionProperty: 'background-color',
    '[data-state=open]': {
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
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

function tooltipState(props: TooltipStateProps) {
  return {
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    open: props.open === true,
  };
}

export const Tooltip = component({
  render(props: TooltipProps) {
    const attrs = tooltipRootAttributes(tooltipState(props));
    const styleAttrs = style.attrs(tooltipStyles.root, props.styles?.root);

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

export const TooltipTrigger = component({
  render(props: TooltipTriggerProps) {
    const attrs = tooltipTriggerAttributes({
      ...tooltipState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });
    const styleAttrs = style.attrs(tooltipStyles.trigger, props.styles?.trigger);

    return (
      <button
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-describedby={attrs['aria-describedby']}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        disabled={props.disabled === true}
        id={props.id}
        kovo-tooltip={attrs['kovo-tooltip']}
        type="button"
      >
        {props.children}
      </button>
    );
  },
});

export const TooltipContent = component({
  render(props: TooltipContentProps) {
    const attrs = tooltipContentAttributes({
      ...tooltipState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });
    const styleAttrs = style.attrs(tooltipStyles.content, props.styles?.content);
    const arrowAttrs = style.attrs(tooltipStyles.arrow);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
        popover={attrs.popover}
        role={attrs.role}
      >
        {props.children}
        <span {...arrowAttrs} aria-hidden="true" />
      </div>
    );
  },
});
