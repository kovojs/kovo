/** @jsxImportSource @jiso/server */
import type { ContactRow, DealRow, PipelineStageBucket } from '../queries.js';
import { money, renderCrmShell, stageBadge } from './chrome.js';

// Pipeline dashboard (route `/`). Reads the `pipelineByStage` aggregate (SUM by
// stage — the out-of-grammar GROUP BY query whose optimism is hand-written in
// mutations.ts) and the `openDeals` rowset, joining deals to their contact for
// display. Each open deal links to its `/deals/:id` detail page.

export interface PipelinePageData {
  buckets: PipelineStageBucket[];
  openDeals: DealRow[];
  contacts: ContactRow[];
}

export function renderPipelinePage({ buckets, openDeals, contacts }: PipelinePageData): string {
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);

  const body = (
    <div class="space-y-8">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Sales pipeline</h1>
        <p class="mt-1 text-sm text-slate-600">
          {money(total)} across {buckets.length} stages, {openDeals.length} deals open now.
        </p>
      </div>

      <section>
        <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">By stage</h2>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {buckets.map((bucket) => (
            <div class="rounded-lg border border-slate-200 bg-white p-4">
              <div class="mb-2">{stageBadge(bucket.stage)}</div>
              <p class="text-lg font-semibold">{money(bucket.total)}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Open deals
        </h2>
        <div class="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th class="px-4 py-2 font-medium">Deal</th>
                <th class="px-4 py-2 font-medium">Contact</th>
                <th class="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              {openDeals.map((deal) => (
                <tr class="hover:bg-slate-50">
                  <td class="px-4 py-2.5">
                    <a
                      class="font-medium text-slate-900 underline-offset-2 hover:underline"
                      href={`/deals/${deal.id}`}
                    >
                      {deal.id.toUpperCase()}
                    </a>
                  </td>
                  <td class="px-4 py-2.5 text-slate-600">
                    {contactsById.get(deal.contactId)?.name ?? deal.contactId}
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums">{money(deal.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

  return renderCrmShell('pipeline', body);
}
