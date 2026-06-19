/** @jsxImportSource @kovojs/server */
import { Badge, type BadgeVariant } from '@kovojs/ui/badge';
import * as style from '@kovojs/style';

// Shared page chrome and formatting helpers for the CRM example UI.

export type CrmSection = 'pipeline' | 'contacts';

const NAV: { href: string; label: string; section: CrmSection }[] = [
  { href: '/', label: 'Pipeline', section: 'pipeline' },
  { href: '/contacts', label: 'Contacts', section: 'contacts' },
];

const chromeStyles = style.create({
  appRoot: {
    backgroundColor: style.tokens.sys.color.surface,
    color: style.tokens.sys.color.onSurface,
    minHeight: '100vh',
  },
  brand: {
    alignItems: 'center',
    color: style.tokens.sys.color.onSurface,
    display: 'flex',
    fontSize: 14,
    fontWeight: 600,
    gap: 8,
    letterSpacing: 0,
    textDecoration: 'none',
  },
  brandMark: {
    backgroundColor: style.tokens.sys.color.primary,
    borderRadius: style.tokens.sys.shape.cornerMedium,
    color: style.tokens.sys.color.onPrimary,
    display: 'grid',
    fontSize: 12,
    fontWeight: 700,
    height: 28,
    placeItems: 'center',
    width: 28,
  },
  header: {
    backgroundColor: style.tokens.sys.color.surfaceContainerLowest,
    borderBottomColor: style.tokens.sys.color.outlineVariant,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
  },
  headerInner: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'space-between',
    marginInline: 'auto',
    maxWidth: 1024,
    paddingBlock: 16,
    paddingInline: 24,
  },
  main: {
    marginInline: 'auto',
    maxWidth: 1024,
    paddingBlock: 32,
    paddingInline: 24,
  },
  nav: {
    alignItems: 'center',
    display: 'flex',
    fontSize: 14,
    gap: 4,
  },
  navLink: {
    borderRadius: style.tokens.sys.shape.cornerMedium,
    fontWeight: 500,
    paddingBlock: 6,
    paddingInline: 12,
    textDecoration: 'none',
  },
  navLinkActive: {
    backgroundColor: style.tokens.sys.color.primary,
    color: style.tokens.sys.color.onPrimary,
  },
  navLinkInactive: {
    color: style.tokens.sys.color.onSurfaceVariant,
    ':hover': {
      backgroundColor: style.tokens.sys.color.surfaceContainer,
      color: style.tokens.sys.color.onSurface,
    },
  },
  stageText: {
    textTransform: 'capitalize',
  },
});

// Form fragments mint ids server-side so each rendered composer is ready to post.
export function freshId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Format an integer dollar amount as `$12,000`. */
export function money(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

// Won is a success; lost is a warning; in-flight stages stay neutral.
const STAGE_VARIANT: Record<string, BadgeVariant> = {
  lead: 'neutral',
  qualified: 'neutral',
  open: 'neutral',
  proposal: 'neutral',
  won: 'success',
  lost: 'warning',
};

export function stageBadgeVariant(stage: string): BadgeVariant {
  return STAGE_VARIANT[stage] ?? 'neutral';
}

/** A capitalized stage chip rendered with the @kojvojs/ui Badge. */
export function stageBadge(stage: string): string {
  return (
    <span style={chromeStyles.stageText}>
      {Badge.definition.render({ variant: stageBadgeVariant(stage), children: stage })}
    </span>
  );
}

export function CrmShell({ active, children }: { active: CrmSection; children?: unknown }): string {
  return (
    <div style={chromeStyles.appRoot}>
      <header style={chromeStyles.header}>
        <div style={chromeStyles.headerInner}>
          <a href="/" style={chromeStyles.brand}>
            <span style={chromeStyles.brandMark}>A</span>
            Atlas CRM
          </a>
          <nav style={chromeStyles.nav}>
            {NAV.map((item) => (
              <a
                href={item.href}
                style={[
                  chromeStyles.navLink,
                  item.section === active
                    ? chromeStyles.navLinkActive
                    : chromeStyles.navLinkInactive,
                ]}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main style={chromeStyles.main}>{children}</main>
    </div>
  );
}
