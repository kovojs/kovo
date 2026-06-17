/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  tooltipContentAttributes,
  tooltipRootAttributes,
  tooltipTriggerAttributes,
} from '@kovojs/headless-ui';
import * as style from '@kovojs/style';

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

export const tooltipStyles = style.create(
  {
    content: {
      backgroundColor: '#0a0a0a',
      borderRadius: 6,
      color: '#ffffff',
      fontSize: 12,
      marginTop: 8,
      maxWidth: 256,
      paddingBlock: 6,
      paddingInline: 10,
      width: 'max-content',
      '[data-state=closed]': {
        display: 'none',
      },
      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    },
    root: {
      color: '#0a0a0a',
      display: 'inline-block',
      fontSize: 14,
      position: 'relative',
      '[data-disabled]': {
        opacity: 0.5,
      },
    },
    trigger: {
      alignItems: 'center',
      backgroundColor: '#ffffff',
      borderColor: '#d4d4d4',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
      color: '#0a0a0a',
      display: 'inline-flex',
      fontSize: 14,
      fontWeight: 500,
      height: 32,
      justifyContent: 'center',
      paddingInline: 10,
      transitionProperty: 'background-color',
      '[data-state=open]': {
        backgroundColor: '#f5f5f5',
      },
      ':focus-visible': {
        outlineColor: '#0a0a0a',
        outlineOffset: 2,
        outlineStyle: 'solid',
        outlineWidth: 2,
      },
      ':hover': {
        backgroundColor: '#fafafa',
      },
    },
  },
  { namespace: 'tooltip', source: 'tooltip.tsx' },
);

export const tooltipClasses = [style.attrs(tooltipStyles.root).class ?? ''] as const;
export const tooltipTriggerClasses = [style.attrs(tooltipStyles.trigger).class ?? ''] as const;
export const tooltipContentClasses = [style.attrs(tooltipStyles.content).class ?? ''] as const;

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

    return (
      <div
        {...styleAttrs}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
        popover={attrs.popover}
        role={attrs.role}
      >
        {props.children}
      </div>
    );
  },
});
