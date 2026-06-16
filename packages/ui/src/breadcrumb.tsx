/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { cn, safeUrl, separatorRootAttributes, type ClassValue } from '@kovojs/headless-ui';

export interface BreadcrumbProps {
  children?: string;
  class?: ClassValue;
  label?: string;
}

export interface BreadcrumbPartProps {
  children?: string;
  class?: ClassValue;
}

export interface BreadcrumbLinkProps extends BreadcrumbPartProps {
  current?: boolean;
  href?: string;
}

export const breadcrumbClassNames = 'flex flex-wrap items-center gap-1.5 text-sm text-neutral-500';
export const breadcrumbListClassNames = 'flex flex-wrap items-center gap-1.5';
export const breadcrumbItemClassNames = 'inline-flex items-center gap-1.5';
export const breadcrumbLinkClassNames =
  'font-medium text-neutral-600 transition-colors hover:text-neutral-950';
export const breadcrumbCurrentClassNames = 'font-medium text-neutral-950';
export const breadcrumbSeparatorClassNames = 'text-neutral-400';
export const breadcrumbClasses = [
  breadcrumbClassNames,
  breadcrumbListClassNames,
  breadcrumbItemClassNames,
  breadcrumbLinkClassNames,
  breadcrumbCurrentClassNames,
  breadcrumbSeparatorClassNames,
] as const;

export const Breadcrumb = component({
  render(props: BreadcrumbProps) {
    return (
      <nav aria-label={props.label ?? 'Breadcrumb'} class={cn(breadcrumbClassNames, props.class)}>
        <ol class={breadcrumbListClassNames}>{props.children}</ol>
      </nav>
    );
  },
});

export const BreadcrumbItem = component({
  render(props: BreadcrumbPartProps) {
    return <li class={cn(breadcrumbItemClassNames, props.class)}>{props.children}</li>;
  },
});

export const BreadcrumbLink = component({
  render(props: BreadcrumbLinkProps) {
    const current = props.current === true;

    return (
      <a
        aria-current={current ? 'page' : undefined}
        class={cn(current ? breadcrumbCurrentClassNames : breadcrumbLinkClassNames, props.class)}
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

    return (
      <li
        aria-hidden="true"
        class={cn(breadcrumbSeparatorClassNames, props.class)}
        data-orientation={attrs['data-orientation']}
        role={attrs.role}
      >
        {props.children ?? '/'}
      </li>
    );
  },
});
