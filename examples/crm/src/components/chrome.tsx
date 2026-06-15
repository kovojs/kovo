/** @jsxImportSource @jiso/server */

// Shared page chrome for the CRM example UI. The app-shell wraps each page()
// return in the document <html>/<head> (with the stylesheet), so these helpers
// render the <body> contents: a top bar with section nav plus a main column.

export type CrmSection = 'pipeline' | 'contacts';

const NAV: { href: string; label: string; section: CrmSection }[] = [
  { href: '/', label: 'Pipeline', section: 'pipeline' },
  { href: '/contacts', label: 'Contacts', section: 'contacts' },
];

/** Format an integer dollar amount as `$12,000`. */
export function money(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

const STAGE_TONE: Record<string, string> = {
  lead: 'bg-slate-100 text-slate-700',
  qualified: 'bg-sky-100 text-sky-700',
  open: 'bg-amber-100 text-amber-800',
  proposal: 'bg-violet-100 text-violet-700',
  won: 'bg-emerald-100 text-emerald-700',
  lost: 'bg-rose-100 text-rose-700',
};

export function stageBadge(stage: string): string {
  const tone = STAGE_TONE[stage] ?? 'bg-slate-100 text-slate-700';
  return (
    <span class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${tone}`}>
      {stage}
    </span>
  );
}

export function renderCrmShell(active: CrmSection, body: string): string {
  return (
    <div class="min-h-screen bg-slate-50 text-slate-900">
      <header class="border-b border-slate-200 bg-white">
        <div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <a href="/" class="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span class="grid h-7 w-7 place-items-center rounded-md bg-slate-900 text-xs font-bold text-white">
              CR
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
