/** @jsxImportSource @kovojs/server */
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
        <div style={dealDetailStyles.stack}>
          <a style={dealDetailStyles.backLink} href="/">
            &larr; Pipeline
          </a>
          <div style={dealDetailStyles.card}>
            <h1 style={dealDetailStyles.heading}>Unknown deal</h1>
            <p style={dealDetailStyles.muted}>
              Deal {dealId.toUpperCase()} does not exist in this demo database.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div style={dealDetailStyles.stack}>
        <a style={dealDetailStyles.backLink} href="/">
          &larr; Pipeline
        </a>

        <div style={dealDetailStyles.card}>
          <div style={dealDetailStyles.rowBetween}>
            <div>
              <h1 style={dealDetailStyles.heading}>Deal {deal.id.toUpperCase()}</h1>
              <p style={dealDetailStyles.muted}>
                {contact ? contact.name : deal.contactId} · owner {deal.ownerId}
              </p>
            </div>
            <div style={dealDetailStyles.stageSummary}>
              <p style={dealDetailStyles.tabularStrong}>{money(deal.amount)}</p>
              <div style={dealDetailStyles.stageMeta}>{stageBadge(deal.stage)}</div>
            </div>
          </div>
          {contact ? (
            <p style={[dealDetailStyles.dividerTop, dealDetailStyles.muted]}>
              <span style={dealDetailStyles.tabularStrong}>{contact.name}</span> · {contact.email}
            </p>
          ) : (
            ''
          )}
        </div>

        {/* Each stage button posts a tiny form and refreshes this region. */}
        <div style={dealDetailStyles.card}>
          <h2 style={dealDetailStyles.sectionLabel}>Move stage</h2>
          <div style={dealDetailStyles.stageWrap}>
            {MOVE_STAGES.map((stage) => (
              <form key={`${deal.id}:${stage}`} {...mutationFormAttributes(moveDeal)}>
                <input type="hidden" name="dealId" value={deal.id} />
                <input type="hidden" name="stage" value={stage} />
                {deal.stage === stage ? (
                  <button
                    type="submit"
                    disabled
                    style={[dealDetailStyles.stageButton, dealDetailStyles.stageButtonActive]}
                  >
                    {stage}
                  </button>
                ) : (
                  <button type="submit" disabled={closed} style={dealDetailStyles.stageButton}>
                    {stage}
                  </button>
                )}
              </form>
            ))}
          </div>
          <div style={dealDetailStyles.dividerTop}>
            {closed ? (
              <p style={dealDetailStyles.muted}>
                This deal is closed ({deal.stage}). Commission is final.
              </p>
            ) : (
              <form key={`${deal.id}:close`} {...mutationFormAttributes(closeDeal)}>
                <input type="hidden" name="dealId" value={deal.id} />
                <button
                  type="submit"
                  style={[dealDetailStyles.stageButton, dealDetailStyles.stageButtonActive]}
                >
                  Close won
                </button>
              </form>
            )}
          </div>
        </div>

        <section>
          <h2 style={dealDetailStyles.sectionLabel}>Activity</h2>
          {activities.length === 0 ? (
            <p style={[dealDetailStyles.card, dealDetailStyles.muted]}>No activity logged yet.</p>
          ) : (
            <ol style={dealDetailStyles.activityList}>
              {activities.map((activity) => (
                <li style={dealDetailStyles.card}>
                  <p style={dealDetailStyles.sectionLabel}>{activity.kind}</p>
                  <p style={dealDetailStyles.muted}>{activity.note}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    );
  },
});
