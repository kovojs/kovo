/** @jsxImportSource @kovojs/server */
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@kovojs/ui/table';
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

function renderStageCard(bucket: PipelineStageBucket): string {
  return Card.definition.render({
    children: (
      <div class="grid gap-2">
        <div>{stageBadge(bucket.stage)}</div>
        <p class="text-lg font-semibold tabular-nums">{money(bucket.total)}</p>
      </div>
    ),
  });
}

function renderOpenDealsTable(openDeals: DealRow[], contactsById: Map<string, ContactRow>): string {
  const head = TableHead.definition.render({
    children: TableRow.definition.render({
      children:
        TableHeaderCell.definition.render({ children: 'Deal' }) +
        TableHeaderCell.definition.render({ children: 'Contact' }) +
        TableHeaderCell.definition.render({ children: 'Amount' }),
    }),
  });

  const rows = openDeals
    .map((deal) =>
      TableRow.definition.render({
        children:
          TableCell.definition.render({
            children: (
              <a
                class="font-medium text-slate-900 underline-offset-2 hover:underline"
                href={`/deals/${deal.id}`}
              >
                {deal.id.toUpperCase()}
              </a>
            ),
          }) +
          TableCell.definition.render({
            children: contactsById.get(deal.contactId)?.name ?? deal.contactId,
          }) +
          TableCell.definition.render({
            children: (<span class="tabular-nums">{money(deal.amount)}</span>),
          }),
      }),
    )
    .join('');

  return Table.definition.render({
    children: head + TableBody.definition.render({ children: rows }),
  });
}

// The interactive region, rendered both inside the full page and as the
// createDeal / moveDeal / closeDeal fragment payload (target = PIPELINE_TARGET).
export function renderPipelineRegion({ buckets, openDeals, contacts }: PipelinePageData): string {
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);

  // SPEC.md §6.3: a no-JS "new deal" form. POSTs to the createDeal mutation
  // (INSERT deal + bump contacts.dealCount); the fragment re-renders the pipeline
  // so the new bucket total and open-deals row appear from server truth. The text
  // primary key is minted at render time; ownerId is the demo session user.
  const composer = Card.definition.render({
    children: (
      <form method="post" action="/_m/createDeal" enhance data-mutation="createDeal">
        <input type="hidden" name="id" value={freshId('d')} />
        <input type="hidden" name="ownerId" value="u1" />
        <div class="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-start">
          <select
            name="contactId"
            required
            class="crm-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {contacts.map((contact) => (
              <option value={contact.id}>{contact.name}</option>
            ))}
          </select>
          <select
            name="stage"
            class="crm-input rounded-md border border-slate-300 px-3 py-2 text-sm capitalize"
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
            class="crm-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          {Button.definition.render({ variant: 'primary', type: 'submit', children: 'Create deal' })}
        </div>
      </form>
    ),
  });

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
          {buckets.map((bucket) => renderStageCard(bucket))}
        </div>
      </section>

      <section>
        <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">New deal</h2>
        {composer}
      </section>

      <section>
        <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Open deals
        </h2>
        <div class="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          {renderOpenDealsTable(openDeals, contactsById)}
        </div>
      </section>
    </div>
  );
}

export function renderPipelinePage(data: PipelinePageData): string {
  return renderCrmShell('pipeline', renderPipelineRegion(data));
}
