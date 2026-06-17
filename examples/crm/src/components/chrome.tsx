/** @jsxImportSource @kovojs/server */
import { Badge, type BadgeVariant } from '@kovojs/ui/badge';

// Shared page chrome for the CRM example UI. The app-shell wraps each page()
// return in the document <html>/<head> (with the stylesheet), so these helpers
// render the <body> contents: a top bar with section nav plus a main column.
// Page chrome (header/nav/container) stays document CSS; content surfaces use the
// @kovojs/ui styled components (Card / Table / Badge / Button).

export type CrmSection = 'pipeline' | 'contacts';

const NAV: { href: string; label: string; section: CrmSection }[] = [
  { href: '/', label: 'Pipeline', section: 'pipeline' },
  { href: '/contacts', label: 'Contacts', section: 'contacts' },
];

// SPEC.md §6.3: addContact / createDeal use text primary keys, so each rendered
// composer mints a unique id. The app-shell renders server-side (Node), where
// crypto.randomUUID is available; a fresh fragment re-render yields a new id, so
// sequential inserts never collide on the text PK.
export function freshId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Format an integer dollar amount as `$12,000`. */
export function money(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

// Map each pipeline stage onto one of the @kovojs/ui Badge variants
// (neutral / success / warning). Won is a success; lost a warning; everything
// in-flight is neutral.
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

export function renderCrmShell(active: CrmSection, body: string): string {
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
      <main class="mx-auto max-w-5xl px-6 py-8">{body}</main>
    </div>
  );
}
