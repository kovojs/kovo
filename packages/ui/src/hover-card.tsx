/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  hoverCardContentAttributes,
  hoverCardRootAttributes,
  hoverCardTriggerAttributes,
} from '@kovojs/headless-ui/hover-card';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';
import { safeUrl } from './safe-url.js';

import { uiTheme } from './theme.js';

export interface HoverCardStyleOverrides {
  content?: style.StyleInput;
  root?: style.StyleInput;
  trigger?: style.StyleInput;
}

export interface HoverCardStateProps {
  disabled?: boolean;
  open?: boolean;
}

export interface HoverCardProps extends HoverCardStateProps {
  children?: string;
  id?: string;
  styles?: HoverCardStyleOverrides;
}

export interface HoverCardTriggerProps extends HoverCardStateProps {
  children?: string;
  contentId?: string;
  href?: string;
  id?: string;
  styles?: HoverCardStyleOverrides;
}

export interface HoverCardContentProps extends HoverCardStateProps {
  children?: string;
  contentId?: string;
  styles?: HoverCardStyleOverrides;
}

export const hoverCardStyles = style.create({
  content: {
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    color: uiTheme.color.foreground,
    fontSize: 14,
    marginTop: 4,
    padding: 12,
    position: 'absolute',
    width: 288,
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
    borderRadius: uiTheme.radius.md,
    color: uiTheme.color.foreground,
    display: 'inline-flex',
    fontSize: 14,
    fontWeight: 500,
    textDecorationLine: 'none',
    textUnderlineOffset: 4,
    '[data-state=open]': {
      textDecorationLine: 'underline',
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
    ':hover': {
      textDecorationLine: 'underline',
    },
  },
});

export const hoverCardClasses = [style.attrs(hoverCardStyles.root).class ?? ''] as const;
export const hoverCardTriggerClasses = [style.attrs(hoverCardStyles.trigger).class ?? ''] as const;
export const hoverCardContentClasses = [style.attrs(hoverCardStyles.content).class ?? ''] as const;

function hoverCardState(props: HoverCardStateProps) {
  return {
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    open: props.open === true,
  };
}

export const HoverCard = component({
  render(props: HoverCardProps) {
    const attrs = hoverCardRootAttributes(hoverCardState(props));
    const styleAttrs = style.attrs(hoverCardStyles.root, props.styles?.root);

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

export const HoverCardTrigger = component({
  render(props: HoverCardTriggerProps) {
    const attrs = hoverCardTriggerAttributes({
      ...hoverCardState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });
    const styleAttrs = style.attrs(hoverCardStyles.trigger, props.styles?.trigger);

    return (
      <a
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-controls={attrs['aria-controls']}
        aria-disabled={props.disabled === true ? 'true' : undefined}
        aria-expanded={attrs['aria-expanded']}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        // SECURITY_FINDINGS.md H3: sanitize the caller href so a dangerous
        // scheme is neutralized to the '#' fallback. Existing semantics kept:
        // omit href when disabled, default to '#' when no href is supplied.
        href={props.disabled === true ? undefined : safeUrl(props.href)}
        id={props.id}
        kovo-hover-card={attrs['kovo-hover-card']}
      >
        {props.children}
      </a>
    );
  },
});

export const HoverCardContent = component({
  render(props: HoverCardContentProps) {
    const attrs = hoverCardContentAttributes({
      ...hoverCardState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });
    const styleAttrs = style.attrs(hoverCardStyles.content, props.styles?.content);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
        popover={attrs.popover}
      >
        {props.children}
      </div>
    );
  },
});
