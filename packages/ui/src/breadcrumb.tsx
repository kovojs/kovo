/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { separatorRootAttributes } from '@kovojs/headless-ui/separator';
import { safeUrl } from '@kovojs/headless-ui';
import * as style from '@kovojs/style';

import { uiTheme } from './theme.js';

export interface BreadcrumbStyleOverrides {
  current?: style.StyleInput;
  item?: style.StyleInput;
  link?: style.StyleInput;
  list?: style.StyleInput;
  root?: style.StyleInput;
  separator?: style.StyleInput;
}

export interface BreadcrumbProps {
  children?: string;
  label?: string;
  styles?: BreadcrumbStyleOverrides;
}

export interface BreadcrumbPartProps {
  children?: string;
  styles?: BreadcrumbStyleOverrides;
}

export interface BreadcrumbLinkProps extends BreadcrumbPartProps {
  current?: boolean;
  href?: string;
}

export const breadcrumbStyles = style.create(
  {
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
      color: uiTheme.color.borderStrong,
    },
  },
  { namespace: 'breadcrumb', source: 'breadcrumb.tsx' },
);

export const breadcrumbClasses = [
  style.attrs(breadcrumbStyles.root).class ?? '',
  style.attrs(breadcrumbStyles.list).class ?? '',
  style.attrs(breadcrumbStyles.item).class ?? '',
  style.attrs(breadcrumbStyles.link).class ?? '',
  style.attrs(breadcrumbStyles.current).class ?? '',
  style.attrs(breadcrumbStyles.separator).class ?? '',
] as const;

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

export const BreadcrumbItem = component({
  render(props: BreadcrumbPartProps) {
    const attrs = style.attrs(breadcrumbStyles.item, props.styles?.item);

    return <li {...attrs}>{props.children}</li>;
  },
});

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

export const BreadcrumbSeparator = component({
  render(props: BreadcrumbPartProps) {
    const attrs = separatorRootAttributes();
    const styleAttrs = style.attrs(breadcrumbStyles.separator, props.styles?.separator);

    return (
      <li
        {...styleAttrs}
        aria-hidden="true"
        data-orientation={attrs['data-orientation']}
        role={attrs.role}
      >
        {props.children ?? '/'}
      </li>
    );
  },
});
