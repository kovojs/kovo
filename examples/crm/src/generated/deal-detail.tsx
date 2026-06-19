// @kovojs-ir — lowered from examples/crm/src/components/deal-detail.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
import { component } from '@kovojs/core';
import { mutationFormAttributes } from '@kovojs/server';
import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';

import { closeDeal, moveDeal, type CrmRequest } from '../mutations.js';
import {
  activityListQuery,
  contactListQuery,
  dealListQuery,
  type ActivityListResult,
  type ContactListResult,
  type DealListResult,
} from '../queries.js';
import { money, stageBadge } from '../components/chrome.js';
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';


// Deal detail for `/deals/:id`. Moving or closing the deal refreshes this region
// with the server-updated stage and amount.

// `won` is reached through the close action because it applies commission.
const MOVE_STAGES = ['lead', 'qualified', 'open', 'proposal', 'lost'] as const;

const dealDetailStyles = style.create({
  activityList: {
    display: 'grid',
    gap: 8,
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  backLink: {
    alignItems: 'center',
    color: tokens.sys.color.onSurfaceVariant,
    display: 'inline-flex',
    fontSize: 14,
    gap: 4,
    textDecoration: 'none',
    ':hover': {
      color: tokens.sys.color.onSurface,
    },
  },
  card: {
    backgroundColor: tokens.sys.color.surfaceContainerLowest,
    borderColor: tokens.sys.color.outlineVariant,
    borderRadius: tokens.sys.shape.cornerMedium,
    borderStyle: 'solid',
    borderWidth: 1,
    padding: 24,
  },
  dividerTop: {
    borderColor: tokens.sys.color.outlineVariant,
    borderTopStyle: 'solid',
    borderTopWidth: 1,
    paddingTop: 16,
  },
  heading: {
    color: tokens.sys.color.onSurface,
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: 0,
    lineHeight: 1.25,
    margin: 0,
  },
  muted: {
    color: tokens.sys.color.onSurfaceVariant,
    fontSize: 14,
  },
  rowBetween: {
    alignItems: 'flex-start',
    display: 'flex',
    gap: 16,
    justifyContent: 'space-between',
  },
  sectionLabel: {
    color: tokens.sys.color.onSurfaceVariant,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.025em',
    marginBlockEnd: 12,
    textTransform: 'uppercase',
  },
  stack: {
    display: 'grid',
    gap: 24,
  },
  stageMeta: {
    marginTop: 4,
  },
  stageSummary: {
    textAlign: 'right',
  },
  stageWrap: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  stageButton: {
    borderColor: tokens.sys.color.outline,
    borderRadius: tokens.sys.shape.cornerSmall,
    borderStyle: 'solid',
    borderWidth: 1,
    color: tokens.sys.color.onSurfaceVariant,
    fontSize: 14,
    fontWeight: 500,
    paddingBlock: 6,
    paddingInline: 12,
    textTransform: 'capitalize',
    ':hover': {
      backgroundColor: tokens.sys.color.surfaceContainer,
    },
    ':disabled': {
      cursor: 'not-allowed',
      opacity: 0.4,
    },
  },
  stageButtonActive: {
    backgroundColor: tokens.sys.color.primary,
    borderColor: tokens.sys.color.primary,
    color: tokens.sys.color.onPrimary,
    cursor: 'default',
  },
  tabularStrong: {
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
  },
});

export const dealDetailStyleCss = style.emitAtomicCss(
  Object.values(dealDetailStyles).flatMap((entry) => entry.__rules ?? []),
);

interface DealDetailRenderSlots {
  request?: CrmRequest | undefined;
}

// Rendered as both the detail page region and the deal-action fragment payload.
export const DealDetailRegion = component({
  props: { dealId: String },
  queries: {
    activityList: activityListQuery,
    contactList: contactListQuery,
    dealList: dealListQuery,
  },
  render: (
    {
      activityList,
      contactList,
      dealId,
      dealList,
    }: {
      activityList: ActivityListResult;
      contactList: ContactListResult;
      dealId: string;
      dealList: DealListResult;
    },
    _state,
    _slots: DealDetailRenderSlots = {},
  ) => {
    const deal = dealList.items.find((item) => item.id === dealId);
    const contact = contactList.items.find((item) => item.id === deal?.contactId);
    const activities = activityList.items.filter((item) => item.dealId === dealId);
    const closed = deal?.stage === 'won' || deal?.stage === 'lost';

    if (!deal) {
      return (
        <div class="kv-deal-detail-d-1r0fv1 kv-deal-detail-gap-nekf6v" data-style-src="examples/crm/src/components/deal-detail.tsx#stack">
          <a class="kv-deal-detail-align-5rg1kv kv-deal-detail-fg-152gzp kv-deal-detail-d-1rbnzz kv-deal-detail-font-mvdwxk kv-deal-detail-gap-zc9vce kv-deal-detail-text-1xhj6c kv-deal-detail-fg-1g0ttt" data-style-src="examples/crm/src/components/deal-detail.tsx#backLink" href="/">
            &larr; Pipeline
          </a>
          <div class="kv-deal-detail-bg-1slxrc kv-deal-detail-bd-1hwkdw kv-deal-detail-bd-q61hl5 kv-deal-detail-bd-11jbsz kv-deal-detail-bd-onm9kl kv-deal-detail-pad-1ekwba" data-style-src="examples/crm/src/components/deal-detail.tsx#card">
            <h1 class="kv-deal-detail-fg-1b909x kv-deal-detail-font-4cosxi kv-deal-detail-font-11kkrq kv-deal-detail-letter-15wj4r kv-deal-detail-line-lk5pgb kv-deal-detail-m-1u5mgo" data-style-src="examples/crm/src/components/deal-detail.tsx#heading">Unknown deal</h1>
            <p class="kv-deal-detail-fg-152gzp kv-deal-detail-font-mvdwxk" data-style-src="examples/crm/src/components/deal-detail.tsx#muted">
              Deal {dealId.toUpperCase()} does not exist in this demo database.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div class="kv-deal-detail-d-1r0fv1 kv-deal-detail-gap-nekf6v" data-style-src="examples/crm/src/components/deal-detail.tsx#stack" kovo-c="deal-detail-region" kovo-deps="activityList contactList dealList" kovo-fragment-target="deal-detail-region" kovo-live-component="components/deal-detail/deal-detail-region" kovo-props={JSON.stringify({ dealId })}>
        <a class="kv-deal-detail-align-5rg1kv kv-deal-detail-fg-152gzp kv-deal-detail-d-1rbnzz kv-deal-detail-font-mvdwxk kv-deal-detail-gap-zc9vce kv-deal-detail-text-1xhj6c kv-deal-detail-fg-1g0ttt" data-style-src="examples/crm/src/components/deal-detail.tsx#backLink" href="/">
          &larr; Pipeline
        </a>

        <div class="kv-deal-detail-bg-1slxrc kv-deal-detail-bd-1hwkdw kv-deal-detail-bd-q61hl5 kv-deal-detail-bd-11jbsz kv-deal-detail-bd-onm9kl kv-deal-detail-pad-1ekwba" data-style-src="examples/crm/src/components/deal-detail.tsx#card">
          <div class="kv-deal-detail-align-cmn1y1 kv-deal-detail-d-7e9pxy kv-deal-detail-gap-hddmtk kv-deal-detail-justify-m1htsu" data-style-src="examples/crm/src/components/deal-detail.tsx#rowBetween">
            <div>
              <h1 class="kv-deal-detail-fg-1b909x kv-deal-detail-font-4cosxi kv-deal-detail-font-11kkrq kv-deal-detail-letter-15wj4r kv-deal-detail-line-lk5pgb kv-deal-detail-m-1u5mgo" data-style-src="examples/crm/src/components/deal-detail.tsx#heading">Deal {deal.id.toUpperCase()}</h1>
              <p class="kv-deal-detail-fg-152gzp kv-deal-detail-font-mvdwxk" data-style-src="examples/crm/src/components/deal-detail.tsx#muted">
                {contact ? contact.name : deal.contactId} · owner {escapeText(deal.ownerId)}
              </p>
            </div>
            <div class="kv-deal-detail-text-1hj3mn" data-style-src="examples/crm/src/components/deal-detail.tsx#stageSummary">
              <p class="kv-deal-detail-font-4v1il5 kv-deal-detail-font-ahhk4k" data-style-src="examples/crm/src/components/deal-detail.tsx#tabularStrong">{money(deal.amount)}</p>
              <div class="kv-deal-detail-m-ju69ms" data-style-src="examples/crm/src/components/deal-detail.tsx#stageMeta">{stageBadge(deal.stage)}</div>
            </div>
          </div>
          {contact ? (
            <p class="kv-deal-detail-bd-1hwkdw kv-deal-detail-bd-1d0mvs kv-deal-detail-bd-14ha4b kv-deal-detail-pad-1irru5 kv-deal-detail-fg-152gzp kv-deal-detail-font-mvdwxk" data-style-src="examples/crm/src/components/deal-detail.tsx#dividerTop; examples/crm/src/components/deal-detail.tsx#muted">
              <span class="kv-deal-detail-font-4v1il5 kv-deal-detail-font-ahhk4k" data-style-src="examples/crm/src/components/deal-detail.tsx#tabularStrong">{escapeText(contact.name)}</span> · {escapeText(contact.email)}
            </p>
          ) : (
            ''
          )}
        </div>

        {/* Each stage button posts a tiny form and refreshes this region. */}
        <div class="kv-deal-detail-bg-1slxrc kv-deal-detail-bd-1hwkdw kv-deal-detail-bd-q61hl5 kv-deal-detail-bd-11jbsz kv-deal-detail-bd-onm9kl kv-deal-detail-pad-1ekwba" data-style-src="examples/crm/src/components/deal-detail.tsx#card">
          <h2 class="kv-deal-detail-fg-152gzp kv-deal-detail-font-m3qnve kv-deal-detail-font-ahhk4k kv-deal-detail-letter-g2l3bv kv-deal-detail-m-1q923g kv-deal-detail-text-hms780" data-style-src="examples/crm/src/components/deal-detail.tsx#sectionLabel">Move stage</h2>
          <div class="kv-deal-detail-d-7e9pxy kv-deal-detail-flex-y8khg5 kv-deal-detail-gap-1qqt4f" data-style-src="examples/crm/src/components/deal-detail.tsx#stageWrap">
            {MOVE_STAGES.map((stage) => (
              <form key={`${deal.id}:${stage}`} {...mutationFormAttributes(moveDeal)}>
                <input type="hidden" name="dealId" value={deal.id} />
                <input type="hidden" name="stage" value={stage} />
                {deal.stage === stage ? (
                  <button
                    type="submit"
                    disabled
                    class="kv-deal-detail-bd-1q2j8m kv-deal-detail-bd-11jbsz kv-deal-detail-bd-onm9kl kv-deal-detail-font-mvdwxk kv-deal-detail-font-8tqi22 kv-deal-detail-pad-i1unra kv-deal-detail-pad-5ey6sh kv-deal-detail-text-zf6o8p kv-deal-detail-bg-16avv7 kv-deal-detail-cursor-ktocf1 kv-deal-detail-opacity-17jtxn kv-deal-detail-bg-1r2h84 kv-deal-detail-bd-17c8lu kv-deal-detail-fg-18v1mg kv-deal-detail-cursor-fs21rq" data-style-src="examples/crm/src/components/deal-detail.tsx#stageButton; examples/crm/src/components/deal-detail.tsx#stageButtonActive"
                  >
                    {stage}
                  </button>
                ) : (
                  <button type="submit" disabled={closed} class="kv-deal-detail-bd-1widmt kv-deal-detail-bd-1q2j8m kv-deal-detail-bd-11jbsz kv-deal-detail-bd-onm9kl kv-deal-detail-fg-152gzp kv-deal-detail-font-mvdwxk kv-deal-detail-font-8tqi22 kv-deal-detail-pad-i1unra kv-deal-detail-pad-5ey6sh kv-deal-detail-text-zf6o8p kv-deal-detail-bg-16avv7 kv-deal-detail-cursor-ktocf1 kv-deal-detail-opacity-17jtxn" data-style-src="examples/crm/src/components/deal-detail.tsx#stageButton">
                    {stage}
                  </button>
                )}
              </form>
            ))}
          </div>
          <div class="kv-deal-detail-bd-1hwkdw kv-deal-detail-bd-1d0mvs kv-deal-detail-bd-14ha4b kv-deal-detail-pad-1irru5" data-style-src="examples/crm/src/components/deal-detail.tsx#dividerTop">
            {closed ? (
              <p class="kv-deal-detail-fg-152gzp kv-deal-detail-font-mvdwxk" data-style-src="examples/crm/src/components/deal-detail.tsx#muted">
                This deal is closed ({escapeText(deal.stage)}). Commission is final.
              </p>
            ) : (
              <form key={`${deal.id}:close`} {...mutationFormAttributes(closeDeal)}>
                <input type="hidden" name="dealId" value={deal.id} />
                <button
                  type="submit"
                  class="kv-deal-detail-bd-1q2j8m kv-deal-detail-bd-11jbsz kv-deal-detail-bd-onm9kl kv-deal-detail-font-mvdwxk kv-deal-detail-font-8tqi22 kv-deal-detail-pad-i1unra kv-deal-detail-pad-5ey6sh kv-deal-detail-text-zf6o8p kv-deal-detail-bg-16avv7 kv-deal-detail-cursor-ktocf1 kv-deal-detail-opacity-17jtxn kv-deal-detail-bg-1r2h84 kv-deal-detail-bd-17c8lu kv-deal-detail-fg-18v1mg kv-deal-detail-cursor-fs21rq" data-style-src="examples/crm/src/components/deal-detail.tsx#stageButton; examples/crm/src/components/deal-detail.tsx#stageButtonActive"
                >
                  Close won
                </button>
              </form>
            )}
          </div>
        </div>

        <section>
          <h2 class="kv-deal-detail-fg-152gzp kv-deal-detail-font-m3qnve kv-deal-detail-font-ahhk4k kv-deal-detail-letter-g2l3bv kv-deal-detail-m-1q923g kv-deal-detail-text-hms780" data-style-src="examples/crm/src/components/deal-detail.tsx#sectionLabel">Activity</h2>
          {activities.length === 0 ? (
            <p class="kv-deal-detail-bg-1slxrc kv-deal-detail-bd-1hwkdw kv-deal-detail-bd-q61hl5 kv-deal-detail-bd-11jbsz kv-deal-detail-bd-onm9kl kv-deal-detail-pad-1ekwba kv-deal-detail-fg-152gzp kv-deal-detail-font-mvdwxk" data-style-src="examples/crm/src/components/deal-detail.tsx#card; examples/crm/src/components/deal-detail.tsx#muted">No activity logged yet.</p>
          ) : (
            <ol class="kv-deal-detail-d-1r0fv1 kv-deal-detail-gap-1qqt4f kv-deal-detail-list-2w1uge kv-deal-detail-m-1u5mgo kv-deal-detail-pad-1kkny9" data-style-src="examples/crm/src/components/deal-detail.tsx#activityList">
              {activities.map((activity) => (
                <li class="kv-deal-detail-bg-1slxrc kv-deal-detail-bd-1hwkdw kv-deal-detail-bd-q61hl5 kv-deal-detail-bd-11jbsz kv-deal-detail-bd-onm9kl kv-deal-detail-pad-1ekwba" data-style-src="examples/crm/src/components/deal-detail.tsx#card">
                  <p class="kv-deal-detail-fg-152gzp kv-deal-detail-font-m3qnve kv-deal-detail-font-ahhk4k kv-deal-detail-letter-g2l3bv kv-deal-detail-m-1q923g kv-deal-detail-text-hms780" data-style-src="examples/crm/src/components/deal-detail.tsx#sectionLabel">{escapeText(activity.kind)}</p>
                  <p class="kv-deal-detail-fg-152gzp kv-deal-detail-font-mvdwxk" data-style-src="examples/crm/src/components/deal-detail.tsx#muted">{escapeText(activity.note)}</p>
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

export const DealDetailRegion$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: DealDetailRegion,
  componentId: "components/deal-detail/deal-detail-region",
}));
