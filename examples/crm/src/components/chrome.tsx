/** @jsxImportSource @kovojs/server */
import { Badge, type BadgeVariant } from '@kovojs/ui/badge';

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
    <span class="capitalize">
      {Badge.definition.render({ variant: stageBadgeVariant(stage), children: stage })}
    </span>
  );
}

export function CrmShell({ active, children }: { active: CrmSection; children?: unknown }): string {
  return (
    <div class="crm-app min-h-screen bg-slate-50 text-slate-900">
      <header class="border-b border-slate-200 bg-white">
        <div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <a href="/" class="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span class="grid h-7 w-7 place-items-center rounded-md bg-slate-900 text-xs font-bold text-white">
              A
            </span>
            Atlas CRM
          </a>
          <nav class="flex items-center gap-1 text-sm">
            {NAV.map((item) => (
              <a
                href={item.href}
                class={`rounded-md px-3 py-1.5 font-medium ${
                  item.section === active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main class="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
