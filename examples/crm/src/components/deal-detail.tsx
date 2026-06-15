/** @jsxImportSource @jiso/server */
import type { ContactRow, DealRow } from '../queries.js';
import { money, renderCrmShell, stageBadge } from './chrome.js';

// Deal detail (route `/deals/:id`). Joins a single deal to its contact and the
// activity timeline. This is the page the pipeline's open-deal rows link into.

export interface ActivityRow {
  id: number;
  dealId: string;
  kind: string;
  note: string;
}

export interface DealDetailPageData {
  deal: DealRow;
  contact: ContactRow | undefined;
  activities: ActivityRow[];
}

export function renderDealDetailPage({ deal, contact, activities }: DealDetailPageData): string {
  const body = (
    <div class="space-y-6">
      <a
        class="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
        href="/"
      >
        &larr; Pipeline
      </a>

      <div class="rounded-lg border border-slate-200 bg-white p-6">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h1 class="text-xl font-bold tracking-tight">Deal {deal.id.toUpperCase()}</h1>
            <p class="mt-1 text-sm text-slate-600">
              {contact ? contact.name : deal.contactId} · owner {deal.ownerId}
            </p>
          </div>
          <div class="text-right">
            <p class="text-2xl font-semibold tabular-nums">{money(deal.amount)}</p>
            <div class="mt-1">{stageBadge(deal.stage)}</div>
          </div>
        </div>
        {contact ? (
          <p class="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-600">
            <span class="font-medium text-slate-900">{contact.name}</span> · {contact.email}
          </p>
        ) : (
          ''
        )}
      </div>

      <section>
        <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Activity</h2>
        {activities.length === 0 ? (
          <p class="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">
            No activity logged yet.
          </p>
        ) : (
          <ol class="space-y-2">
            {activities.map((activity) => (
              <li class="rounded-lg border border-slate-200 bg-white p-4">
                <p class="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {activity.kind}
                </p>
                <p class="mt-1 text-sm text-slate-700">{activity.note}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );

  return renderCrmShell('pipeline', body);
}
