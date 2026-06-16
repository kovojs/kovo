/** @jsxImportSource @kovojs/server */
import type { ContactRow, DealRow, PipelineStageBucket } from '../queries.js';
import { freshId, money, renderCrmShell, stageBadge } from './chrome.js';

// Pipeline dashboard (route `/`). Reads the `pipelineByStage` aggregate (SUM by
// stage — the out-of-grammar GROUP BY query whose optimism is hand-written in
// mutations.ts) and the `openDeals` rowset, joining deals to their contact for
// display. Each open deal links to its `/deals/:id` detail page. The whole region
// is a `kovo-fragment-target` host so the createDeal / moveDeal / closeDeal
// mutationResponse can re-render the pipeline from server truth: opening a new
// deal morphs the bucket totals and the open-deals table in place (SPEC.md §9.1).

export const PIPELINE_TARGET = 'crm-pipeline';

// The stages a new deal can start in (mirrors the demo data / pipelineByStage
// buckets). A new deal opens in one of these; 'won' is reached via closeDeal.
const NEW_DEAL_STAGES = ['lead', 'qualified', 'open', 'proposal'] as const;

export interface PipelinePageData {
  buckets: PipelineStageBucket[];
  openDeals: DealRow[];
  contacts: ContactRow[];
}

// The interactive region, rendered both inside the full page and as the
// createDeal / moveDeal / closeDeal fragment payload (target = PIPELINE_TARGET).
export function renderPipelineRegion({ buckets, openDeals, contacts }: PipelinePageData): string {
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);

  return (
    <div class="space-y-8" kovo-fragment-target={PIPELINE_TARGET}>
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

      {/* SPEC.md §6.3: a no-JS "new deal" form. POSTs to the createDeal mutation
          (INSERT deal + bump contacts.dealCount); the fragment re-renders the
          pipeline so the new bucket total and open-deals row appear from server
          truth. The text primary key is minted at render time; ownerId is the
          demo session user. */}
      <section>
        <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">New deal</h2>
        <form
          method="post"
          action="/_m/createDeal"
          enhance
          data-mutation="createDeal"
          class="rounded-lg border border-slate-200 bg-white p-4"
        >
          <input type="hidden" name="id" value={freshId('d')} />
          <input type="hidden" name="ownerId" value="u1" />
          <div class="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-start">
            <select
              name="contactId"
              required
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {contacts.map((contact) => (
                <option value={contact.id}>{contact.name}</option>
              ))}
            </select>
            <select
              name="stage"
              class="rounded-md border border-slate-300 px-3 py-2 text-sm capitalize"
            >
              {NEW_DEAL_STAGES.map((stage) => (
                <option value={stage}>{stage}</option>
              ))}
            </select>
            <input
              name="amount"
              type="number"
              min="0"
              required
              placeholder="Amount"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              class="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Create deal
            </button>
          </div>
        </form>
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
}

export function renderPipelinePage(data: PipelinePageData): string {
  return renderCrmShell('pipeline', renderPipelineRegion(data));
}
