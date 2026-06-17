// @kovojs-ir — lowered from examples/crm/src/components/pipeline.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
import { component } from '@kovojs/core';
import { mutationFormAttributes } from '@kovojs/server';
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

import { createDeal } from '../mutations.js';
import {
  contactListQuery,
  openDealsQuery,
  pipelineByStageQuery,
  type ContactListResult,
  type ContactRow,
  type DealRow,
  type OpenDealsResult,
  type PipelineByStageResult,
  type PipelineStageBucket,
} from '../queries.js';
import { freshId, money, renderCrmShell, stageBadge } from '../components/chrome.js';
import { componentLiveTargetRenderer } from '@kovojs/server/internal/wire';


// Pipeline dashboard (route `/`). Reads the `pipelineByStage` aggregate (SUM by
// stage — the out-of-grammar GROUP BY query whose optimism is hand-written in
// mutations.ts) and the `openDeals` rowset, joining deals to their contact for
// display. Each open deal links to its `/deals/:id` detail page. The whole region
// is a `kovo-fragment-target` host so the createDeal / moveDeal / closeDeal
// mutationResponse can re-render the pipeline from server truth: opening a new
// deal morphs the bucket totals and the open-deals table in place (SPEC.md §9.1).

export const PIPELINE_TARGET = 'pipeline-region';

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
            children: <span class="tabular-nums">{money(deal.amount)}</span>,
          }),
      }),
    )
    .join('');

  return Table.definition.render({
    children: head + TableBody.definition.render({ children: rows }),
  });
}

// The interactive region, rendered both inside the full page and as the
// createDeal / moveDeal / closeDeal fragment payload. SPEC.md §4.8: the
// query-backed component root derives its fragment target in generated output.
export const PipelineRegion = component({
  queries: {
    contactList: contactListQuery,
    openDeals: openDealsQuery,
    pipelineByStage: pipelineByStageQuery,
  },
  render: ({
    contactList,
    openDeals,
    pipelineByStage,
  }: {
    contactList: ContactListResult;
    openDeals: OpenDealsResult;
    pipelineByStage: PipelineByStageResult;
  }) => {
    const contacts = contactList.items;
    const buckets = pipelineByStage.buckets;
    const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
    const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);

    return (
      <div class="space-y-8" kovo-c="pipeline-region" kovo-deps="contactList openDeals pipelineByStage" kovo-fragment-target="pipeline-region" kovo-live-component="components/pipeline/pipeline-region">
        <div>
          <h1 class="text-2xl font-bold tracking-tight">Sales pipeline</h1>
          <p class="mt-1 text-sm text-slate-600">
            {money(total)} across {escapeText(buckets.length)} stages, <span data-bind="openDeals.items.length">{openDeals.items.length}</span>{' '}
            deals open now.
          </p>
        </div>

        <section>
          <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            By stage
          </h2>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {buckets.map((bucket) => renderStageCard(bucket))}
          </div>
        </section>

        {/* SPEC.md §6.3: a no-JS "new deal" form. POSTs to the createDeal mutation
          (INSERT deal + bump contacts.dealCount); the fragment re-renders the
          pipeline so the new bucket total and open-deals row appear from server
          truth. The text primary key is minted at render time; ownerId is the
          demo session user. */}
        <section>
          <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            New deal
          </h2>
          <form
            {...mutationFormAttributes(createDeal)}
            class="rounded-lg border border-slate-200 bg-white p-4"
          >
            <input type="hidden" name="id" value={freshId('d')} />
            <input type="hidden" name="ownerId" value="u1" />
            <div class="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-start">
              <select
                name="contactId"
                required
                class="crm-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {contacts.map((contact) => (
                  <option value={contact.id}>{escapeText(contact.name)}</option>
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
              {Button.definition.render({
                children: 'Create deal',
                type: 'submit',
                variant: 'primary',
              })}
            </div>
          </form>
        </section>

        <section>
          <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Open deals
          </h2>
          {renderOpenDealsTable(openDeals.items, contactsById)}
        </section>
      </div>
    );
  },
});
PipelineRegion.name = "components/pipeline/pipeline-region";

export function renderPipelineRegion({ buckets, openDeals, contacts }: PipelinePageData): string {
  return PipelineRegion.definition.render({
    contactList: { items: contacts },
    openDeals: { items: openDeals },
    pipelineByStage: { buckets },
  });
}

export function renderPipelinePage(data: PipelinePageData): string {
  return renderCrmShell('pipeline', renderPipelineRegion(data));
}

export const PipelineRegion$liveTargetRenderer = componentLiveTargetRenderer({
  component: PipelineRegion,
  componentId: "components/pipeline/pipeline-region",
  queries: [
    {
      name: "contactList",
      query: contactListQuery,
    },
    {
      name: "openDeals",
      query: openDealsQuery,
    },
    {
      name: "pipelineByStage",
      query: pipelineByStageQuery,
    },
  ],
});
