/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { csrfField, mutationFormAttributes } from '@kovojs/server';
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

import { createDeal, crmCsrf, type CrmRequest } from '../mutations.js';
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
import { freshId, money, stageBadge } from '../components/chrome.js';

// Pipeline dashboard for `/`. A new deal refreshes the stage totals and open
// deals table.

// A new deal starts in one of these stages; closing moves it to `won`.
const NEW_DEAL_STAGES = ['lead', 'qualified', 'open', 'proposal'] as const;

interface PipelineRenderSlots {
  request?: CrmRequest | undefined;
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

// Rendered as both the full page region and the pipeline fragment payload.
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
  }, _state, slots: PipelineRenderSlots = {}) => {
    const contacts = contactList.items;
    const buckets = pipelineByStage.buckets;
    const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
    const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);

    return (
      <div class="space-y-8">
        <div>
          <h1 class="text-2xl font-bold tracking-tight">Sales pipeline</h1>
          <p class="mt-1 text-sm text-slate-600">
            {money(total)} across {buckets.length} stages, <span>{openDeals.items.length}</span>{' '}
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

        {/* The refreshed fragment resets the form with a fresh deal id. */}
        <section>
          <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            New deal
          </h2>
          <form
            {...mutationFormAttributes(createDeal)}
            class="rounded-lg border border-slate-200 bg-white p-4"
          >
            {slots.request ? csrfField(slots.request, crmCsrf) : ''}
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
