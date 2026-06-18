/** @jsxImportSource @kovojs/server */
import { Badge, type BadgeVariant } from '@kovojs/ui/badge';
import * as style from '@kovojs/style';

import { crmStyles } from '../styles.js';

// Shared page chrome and formatting helpers for the CRM example UI.

export type CrmSection = 'pipeline' | 'contacts';

const NAV: { href: string; label: string; section: CrmSection }[] = [
  { href: '/', label: 'Pipeline', section: 'pipeline' },
  { href: '/contacts', label: 'Contacts', section: 'contacts' },
];

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
    <span {...style.attrs(crmStyles.stageText)}>
      {Badge.definition.render({ variant: stageBadgeVariant(stage), children: stage })}
    </span>
  );
}

export function CrmShell({ active, children }: { active: CrmSection; children?: unknown }): string {
  return (
    <div {...style.attrs(crmStyles.appRoot)}>
      <header {...style.attrs(crmStyles.header)}>
        <div {...style.attrs(crmStyles.headerInner)}>
          <a href="/" {...style.attrs(crmStyles.brand)}>
            <span {...style.attrs(crmStyles.brandMark)}>A</span>
            Atlas CRM
          </a>
          <nav {...style.attrs(crmStyles.nav)}>
            {NAV.map((item) => (
              <a
                href={item.href}
                {...style.attrs(
                  crmStyles.navLink,
                  item.section === active ? crmStyles.navLinkActive : crmStyles.navLinkInactive,
                )}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main {...style.attrs(crmStyles.main)}>{children}</main>
    </div>
  );
}
