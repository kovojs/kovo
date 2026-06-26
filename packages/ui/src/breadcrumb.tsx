/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { separatorRootAttributes } from '@kovojs/headless-ui/separator';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';
import { safeUrl } from './safe-url.js';

import { uiTheme } from './theme.js';

/**
 * Style override slots accepted by the breadcrumb components.
 *
 * @example
 * import type { BreadcrumbStyleOverrides } from "@kovojs/ui/breadcrumb";
 * const styles: BreadcrumbStyleOverrides = {};
 */
export interface BreadcrumbStyleOverrides {
  current?: style.StyleInput;
  item?: style.StyleInput;
  link?: style.StyleInput;
  list?: style.StyleInput;
  root?: style.StyleInput;
  separator?: style.StyleInput;
}

/**
 * Props for the breadcrumb component.
 *
 * @example
 * import type { BreadcrumbProps } from "@kovojs/ui/breadcrumb";
 * const props: BreadcrumbProps = { children: 'Content' };
 */
export interface BreadcrumbProps {
  children?: string;
  label?: string;
  styles?: BreadcrumbStyleOverrides;
}

/**
 * Props for the breadcrumb part component.
 *
 * @example
 * import type { BreadcrumbPartProps } from "@kovojs/ui/breadcrumb";
 * const props: BreadcrumbPartProps = { children: 'Content' };
 */
export interface BreadcrumbPartProps {
  children?: string;
  styles?: BreadcrumbStyleOverrides;
}

/**
 * Props for the breadcrumb link component.
 *
 * @example
 * import type { BreadcrumbLinkProps } from "@kovojs/ui/breadcrumb";
 * const props: BreadcrumbLinkProps = { children: 'Content' };
 */
export interface BreadcrumbLinkProps extends BreadcrumbPartProps {
  current?: boolean;
  href?: string;
}

/**
 * Style definitions used by the breadcrumb components.
 *
 * @example
 * import { breadcrumbStyles } from "@kovojs/ui/breadcrumb";
 * const styles = breadcrumbStyles;
 */
export const breadcrumbStyles = style.create({
  current: {
    color: uiTheme.color.foreground,
    fontWeight: 500,
  },
  item: {
    alignItems: 'center',
    columnGap: 6,
    display: 'inline-flex',
  },
  link: {
    color: uiTheme.color.foregroundMuted,
    fontWeight: 500,
    transitionProperty: 'color',
    ':hover': {
      color: uiTheme.color.foreground,
    },
  },
  list: {
    alignItems: 'center',
    columnGap: 6,
    display: 'flex',
    flexWrap: 'wrap',
  },
  root: {
    alignItems: 'center',
    color: uiTheme.color.foregroundMuted,
    columnGap: 6,
    display: 'flex',
    flexWrap: 'wrap',
    fontSize: 14,
  },
  separator: {
    alignItems: 'center',
    color: uiTheme.color.borderStrong,
    display: 'inline-flex',
    fontSize: 14,
    userSelect: 'none',
    // Default separator is a small right-chevron caret (CSS border idiom,
    // rotate(-45deg)) instead of literal '/' text.
    '::after': {
      borderColor: uiTheme.color.foregroundMuted,
      borderStyle: 'solid',
      borderWidth: '0 2px 2px 0',
      content: '""',
      flexShrink: 0,
      height: 7,
      transform: 'rotate(-45deg)',
      width: 7,
    },
  },
  // Applied when the caller supplies explicit separator text: suppress the
  // default chevron so the literal glyph (e.g. '>') is shown on its own.
  separatorText: {
    '::after': {
      content: 'none',
    },
  },
});

/**
 * Renders the styled breadcrumb primitive.
 *
 * @example
 * import { Breadcrumb } from "@kovojs/ui/breadcrumb";
 * const component = Breadcrumb;
 */
export const Breadcrumb = component({
  render(props: BreadcrumbProps) {
    const rootAttrs = style.attrs(breadcrumbStyles.root, props.styles?.root);
    const listAttrs = style.attrs(breadcrumbStyles.list, props.styles?.list);

    return (
      <nav {...rootAttrs} aria-label={props.label ?? 'Breadcrumb'}>
        <ol {...listAttrs}>{props.children}</ol>
      </nav>
    );
  },
});

/**
 * Renders the styled breadcrumb item primitive.
 *
 * @example
 * import { BreadcrumbItem } from "@kovojs/ui/breadcrumb";
 * const component = BreadcrumbItem;
 */
export const BreadcrumbItem = component({
  render(props: BreadcrumbPartProps) {
    const attrs = style.attrs(breadcrumbStyles.item, props.styles?.item);

    return <li {...attrs}>{props.children}</li>;
  },
});

/**
 * Renders the styled breadcrumb link primitive.
 *
 * @example
 * import { BreadcrumbLink } from "@kovojs/ui/breadcrumb";
 * const component = BreadcrumbLink;
 */
export const BreadcrumbLink = component({
  render(props: BreadcrumbLinkProps) {
    const current = props.current === true;
    const attrs = style.attrs(
      current ? breadcrumbStyles.current : breadcrumbStyles.link,
      current ? props.styles?.current : props.styles?.link,
    );

    return (
      <a
        {...attrs}
        {...passThroughProps(props)}
        aria-current={current ? 'page' : undefined}
        // SECURITY_FINDINGS.md H3: route the caller href through safeUrl so a
        // `javascript:`/`data:` scheme is neutralized; keep the existing
        // undefined semantics (omit href entirely when there is none / current).
        href={current || props.href === undefined ? undefined : safeUrl(props.href)}
      >
        {props.children}
      </a>
    );
  },
});

/**
 * Renders the styled breadcrumb separator primitive.
 *
 * @example
 * import { BreadcrumbSeparator } from "@kovojs/ui/breadcrumb";
 * const component = BreadcrumbSeparator;
 */
export const BreadcrumbSeparator = component({
  render(props: BreadcrumbPartProps) {
    const attrs = separatorRootAttributes();
    const hasText = props.children !== undefined;
    const styleAttrs = style.attrs(
      breadcrumbStyles.separator,
      hasText ? breadcrumbStyles.separatorText : undefined,
      props.styles?.separator,
    );

    return (
      <li
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-hidden="true"
        data-orientation={attrs['data-orientation']}
        role={attrs.role}
      >
        {props.children}
      </li>
    );
  },
});
