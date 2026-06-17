/** @jsxImportSource @kovojs/server */
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';
import { Separator } from '@kovojs/ui/separator';
import { money, renderCrmShell, stageBadge, stageBadgeVariant } from './chrome.js';

// Deal detail (route `/deals/:id`). Joins a single deal to its contact and the
// activity timeline. This is the page the pipeline's open-deal rows link into.
// The whole region is a `kovo-fragment-target` host so the moveDeal / closeDeal
// mutationResponse can re-render it from server truth: moving the deal to a new
// stage or closing it (won, server-computed commission) both morph this region
// in place (SPEC.md §9.1).
//
// The detail route loads the persisted row directly (not via the derivable
// rowset queries), so it carries the presentational-only columns the query
// shapes omit — the deal `title` and the contact `company` / job `title` — see
// db.ts / schema.ts (SPEC.md §10.5: those columns are never written by a
// mutation, so the derived optimism stays clean).

export const DEAL_DETAIL_TARGET = 'crm-deal-detail';

// The pipeline stages a deal can be moved through (mirrors the demo data + the
// pipelineByStage buckets). 'won' is reached via the close-deal action (which
// also applies the server commission), so it is not a plain move target.
const MOVE_STAGES = ['lead', 'qualified', 'open', 'proposal', 'lost'] as const;

export interface ActivityRow {
  id: number;
  dealId: string;
  kind: string;
  note: string;
}

/** The full persisted deal row (rowset shape + the presentational `title`). */
export interface DetailDeal {
  id: string;
  contactId: string;
  stage: string;
  amount: number;
  ownerId: string;
  title: string;
}

/** The full persisted contact row (rowset shape + presentational company/title). */
export interface DetailContact {
  id: string;
  name: string;
  email: string;
  ownerId: string;
  dealCount: number;
  company: string;
  title: string;
}

export interface DealDetailPageData {
  deal: DetailDeal;
  contact: DetailContact | undefined;
  activities: ActivityRow[];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

// The interactive region, rendered inside the page and as the moveDeal /
// closeDeal fragment payload (target = DEAL_DETAIL_TARGET).
export function renderDealDetailRegion({ deal, contact, activities }: DealDetailPageData): string {
  const closed = deal.stage === 'won' || deal.stage === 'lost';

  const summaryCard = Card.definition.render({
    children: (
      <div class="grid gap-5">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-400">
              Deal {deal.id.toUpperCase()}
            </p>
            <h1 class="mt-1 text-xl font-bold tracking-tight">{deal.title}</h1>
            <p class="mt-1 text-sm text-slate-500">
              {contact ? contact.name : deal.contactId} · owner {deal.ownerId}
            </p>
          </div>
          <div class="shrink-0 text-right">
            <p class="text-2xl font-semibold tabular-nums">{money(deal.amount)}</p>
            <div class="mt-1.5 flex justify-end">{stageBadge(deal.stage)}</div>
          </div>
        </div>
        {contact ? (
          <div class="grid gap-3">
            {Separator.definition.render({})}
            <div class="flex items-center gap-3">
              <span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                {initials(contact.name)}
              </span>
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold text-slate-900">{contact.name}</p>
                <p class="truncate text-sm text-slate-500">
                  {contact.title} · {contact.company}
                </p>
                <p class="truncate text-sm text-slate-400">{contact.email}</p>
              </div>
            </div>
          </div>
        ) : (
          ''
        )}
      </div>
    ),
  });

  // SPEC.md §6.3: no-JS "move stage" + "close deal" controls. Each button is its
  // own enhance form posting the deal's id to a mutation endpoint; the fragment
  // re-renders this region so the new stage/amount appear from server truth
  // (closeDeal applies the server commission). The current stage's move button is
  // shown active, and once won/lost the deal is closed.
  const actionsCard = Card.definition.render({
    children: (
      <div class="grid gap-4">
        <h2 class="text-xs font-semibold uppercase tracking-wide text-slate-500">Move stage</h2>
        <div class="flex flex-wrap gap-2">
          {MOVE_STAGES.map((stage) => {
            const active = deal.stage === stage;
            return (
              <form method="post" action="/_m/moveDeal" enhance data-mutation="moveDeal">
                <input type="hidden" name="dealId" value={deal.id} />
                <input type="hidden" name="stage" value={stage} />
                {active
                  ? Badge.definition.render({
                      variant: stageBadgeVariant(stage),
                      children: stage,
                    })
                  : Button.definition.render({
                      variant: 'secondary',
                      size: 'sm',
                      type: 'submit',
                      disabled: closed,
                      children: stage,
                    })}
              </form>
            );
          })}
        </div>
        {Separator.definition.render({})}
        {closed ? (
          <p class="text-sm text-slate-500">
            This deal is closed ({deal.stage}). Commission is final.
          </p>
        ) : (
          <form method="post" action="/_m/closeDeal" enhance data-mutation="closeDeal">
            <input type="hidden" name="dealId" value={deal.id} />
            {Button.definition.render({
              variant: 'primary',
              size: 'sm',
              type: 'submit',
              children: 'Close won',
            })}
          </form>
        )}
      </div>
    ),
  });

  const timelineCard = Card.definition.render({
    children: (
      <div class="grid gap-4">
        <h2 class="text-xs font-semibold uppercase tracking-wide text-slate-500">Activity</h2>
        {activities.length === 0 ? (
          <p class="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">
            No activity logged yet.
          </p>
        ) : (
          <ol class="grid gap-3">
            {activities.map((activity) => (
              <li class="border-l-2 border-slate-200 pl-4">
                <p class="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {activity.kind}
                </p>
                <p class="mt-0.5 text-sm text-slate-700">{activity.note}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    ),
  });

  return (
    <div class="space-y-6" kovo-fragment-target={DEAL_DETAIL_TARGET}>
      <a
        class="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-900"
        href="/"
      >
        &larr; Back to pipeline
      </a>
      {summaryCard}
      {actionsCard}
      {timelineCard}
    </div>
  );
}

export function renderDealDetailPage(data: DealDetailPageData): string {
  return renderCrmShell('pipeline', renderDealDetailRegion(data));
}
