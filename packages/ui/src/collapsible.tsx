/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  collapsibleContentAttributes,
  collapsibleRootAttributes,
  collapsibleTriggerAttributes,
} from '@kovojs/headless-ui/collapsible';
import * as style from '@kovojs/style';

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

export const collapsibleStyles = style.create(
  {
    content: {
      color: '#404040',
      fontSize: 14,
      paddingBottom: 12,
      paddingInline: 12,
      '[data-state=closed]': {
        display: 'none',
      },
    },
    root: {
      backgroundColor: '#ffffff',
      borderColor: '#e5e5e5',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      color: '#0a0a0a',
      fontSize: 14,
      '[data-disabled]': {
        opacity: 0.5,
      },
    },
    trigger: {
      color: '#0a0a0a',
      cursor: 'pointer',
      fontWeight: 500,
      outlineStyle: 'none',
      paddingBlock: 8,
      paddingInline: 12,
      '[data-disabled]': {
        cursor: 'not-allowed',
        opacity: 0.5,
      },
      '[data-state=open]': {
        backgroundColor: '#fafafa',
      },
      ':focus-visible': {
        outlineColor: '#0a0a0a',
        outlineOffset: 2,
        outlineStyle: 'solid',
        outlineWidth: 2,
      },
    },
  },
  { namespace: 'collapsible', source: 'collapsible.tsx' },
);

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
