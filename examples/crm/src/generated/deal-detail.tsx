// @kovojs-ir — lowered from examples/crm/src/components/deal-detail.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server';
import { component } from '@kovojs/core';
import { mutationFormAttributes } from '@kovojs/server';

import { closeDeal, moveDeal } from '../mutations.js';
import {
  activityListQuery,
  contactListQuery,
  dealListQuery,
  type ActivityListResult,
  type ActivityRow,
  type ContactListResult,
  type ContactRow,
  type DealListResult,
  type DealRow,
} from '../queries.js';
import { money, renderCrmShell, stageBadge } from '../components/chrome.js';

// Deal detail (route `/deals/:id`). Joins a single deal to its contact and the
// activity timeline. This is the page the pipeline's open-deal rows link into.
// The whole region is a `kovo-fragment-target` host so the moveDeal / closeDeal
// mutationResponse can re-render it from server truth: moving the deal to a new
// stage or closing it (won, server-computed commission) both morph this region
// in place (SPEC.md §9.1).

export const DEAL_DETAIL_TARGET = 'deal-detail-region';

// The pipeline stages a deal can be moved through (mirrors the demo data + the
// pipelineByStage buckets). 'won' is reached via the close-deal action (which
// also applies the server commission), so it is not a plain move target.
const MOVE_STAGES = ['lead', 'qualified', 'open', 'proposal', 'lost'] as const;

export interface DealDetailPageData {
  deal: DealRow;
  contact: ContactRow | undefined;
  activities: ActivityRow[];
}

// The interactive region, rendered inside the page and as the moveDeal /
// closeDeal fragment payload. SPEC.md §4.8: the query-backed component root
// derives its fragment target in the generated module.
export const DealDetailRegion = component({
  props: { dealId: String },
  queries: {
    activityList: activityListQuery,
    contactList: contactListQuery,
    dealList: dealListQuery,
  },
  render: ({
    activityList,
    contactList,
    dealId,
    dealList,
  }: {
    activityList: ActivityListResult;
    contactList: ContactListResult;
    dealId: string;
    dealList: DealListResult;
  }) => {
    const deal = dealList.items.find((item) => item.id === dealId) ?? dealList.items[0];
    const contact = contactList.items.find((item) => item.id === deal?.contactId);
    const activities = activityList.items.filter((item) => item.dealId === dealId);
    const closed = deal?.stage === 'won' || deal?.stage === 'lost';

    if (!deal) return <div class="space-y-6"></div>;

    return (
      <div class="space-y-6" kovo-c="deal-detail-region" kovo-deps="activityList contactList dealList" kovo-fragment-target="deal-detail-region">
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
              {contact ? contact.name : deal.contactId} · owner {escapeText(deal.ownerId)}
            </p>
          </div>
          <div class="text-right">
            <p class="text-2xl font-semibold tabular-nums">{money(deal.amount)}</p>
            <div class="mt-1">{stageBadge(deal.stage)}</div>
          </div>
        </div>
        {contact ? (
          <p class="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-600">
            <span class="font-medium text-slate-900">{escapeText(contact.name)}</span> · {escapeText(contact.email)}
          </p>
        ) : (
          ''
        )}
      </div>

      {/* SPEC.md §6.3: no-JS "move stage" + "close deal" controls. Each button is
          its own enhance form posting the deal's id to a mutation endpoint; the
          fragment re-renders this region so the new stage/amount appear from
          server truth (closeDeal applies the server commission, so the amount is
          whatever Postgres computed). The current stage's move button is
          disabled, and once won/lost the deal is closed. */}
      <div class="rounded-lg border border-slate-200 bg-white p-5">
        <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Move stage
        </h2>
        <div class="flex flex-wrap gap-2">
          {MOVE_STAGES.map((stage) => (
            <form {...mutationFormAttributes(moveDeal)}>
              <input type="hidden" name="dealId" value={deal.id} />
              <input type="hidden" name="stage" value={stage} />
              <button
                type="submit"
                disabled={deal.stage === stage || closed}
                class={`rounded-md border px-3 py-1.5 text-sm font-medium capitalize ${
                  deal.stage === stage
                    ? 'cursor-default border-slate-300 bg-slate-900 text-white'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40'
                }`}
              >
                {stage}
              </button>
            </form>
          ))}
        </div>
        <div class="mt-4 border-t border-slate-100 pt-4">
          {closed ? (
            <p class="text-sm text-slate-500">
              This deal is closed ({escapeText(deal.stage)}). Commission is final.
            </p>
          ) : (
            <form {...mutationFormAttributes(closeDeal)}>
              <input type="hidden" name="dealId" value={deal.id} />
              <button
                type="submit"
                class="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Close won
              </button>
            </form>
          )}
        </div>
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
                  {escapeText(activity.kind)}
                </p>
                <p class="mt-1 text-sm text-slate-700">{escapeText(activity.note)}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
    );
  },
});
DealDetailRegion.name = "components/deal-detail/deal-detail-region";

export function renderDealDetailRegion({ deal, contact, activities }: DealDetailPageData): string {
  return DealDetailRegion.definition.render({
    activityList: { items: activities },
    contactList: { items: contact ? [contact] : [] },
    dealId: deal.id,
    dealList: { items: [deal] },
  });
}

export function renderDealDetailPage(data: DealDetailPageData): string {
  return renderCrmShell('pipeline', renderDealDetailRegion(data));
}
