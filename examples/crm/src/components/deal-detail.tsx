/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { csrfField, mutationFormAttributes } from '@kovojs/server';
import * as style from '@kovojs/style';

import { closeDeal, crmCsrf, moveDeal, type CrmRequest } from '../mutations.js';
import {
  activityListQuery,
  contactListQuery,
  dealListQuery,
  type ActivityListResult,
  type ContactListResult,
  type DealListResult,
} from '../queries.js';
import { money, stageBadge } from '../components/chrome.js';
import { crmStyles } from '../styles.js';

// Deal detail for `/deals/:id`. Moving or closing the deal refreshes this region
// with the server-updated stage and amount.

// `won` is reached through the close action because it applies commission.
const MOVE_STAGES = ['lead', 'qualified', 'open', 'proposal', 'lost'] as const;

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
    slots: DealDetailRenderSlots = {},
  ) => {
    const deal = dealList.items.find((item) => item.id === dealId);
    const contact = contactList.items.find((item) => item.id === deal?.contactId);
    const activities = activityList.items.filter((item) => item.dealId === dealId);
    const closed = deal?.stage === 'won' || deal?.stage === 'lost';

    if (!deal) {
      return (
        <div {...style.attrs(crmStyles.stack)}>
          <a {...style.attrs(crmStyles.backLink)} href="/">
            &larr; Pipeline
          </a>
          <div {...style.attrs(crmStyles.card)}>
            <h1 {...style.attrs(crmStyles.heading)}>Unknown deal</h1>
            <p {...style.attrs(crmStyles.muted)}>
              Deal {dealId.toUpperCase()} does not exist in this demo database.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div {...style.attrs(crmStyles.stack)}>
        <a {...style.attrs(crmStyles.backLink)} href="/">
          &larr; Pipeline
        </a>

        <div {...style.attrs(crmStyles.card)}>
          <div {...style.attrs(crmStyles.rowBetween)}>
            <div>
              <h1 {...style.attrs(crmStyles.heading)}>Deal {deal.id.toUpperCase()}</h1>
              <p {...style.attrs(crmStyles.muted)}>
                {contact ? contact.name : deal.contactId} · owner {deal.ownerId}
              </p>
            </div>
            <div class="text-right">
              <p {...style.attrs(crmStyles.tabularStrong)}>{money(deal.amount)}</p>
              <div class="mt-1">{stageBadge(deal.stage)}</div>
            </div>
          </div>
          {contact ? (
            <p {...style.attrs(crmStyles.dividerTop, crmStyles.muted)}>
              <span {...style.attrs(crmStyles.tabularStrong)}>{contact.name}</span> ·{' '}
              {contact.email}
            </p>
          ) : (
            ''
          )}
        </div>

        {/* Each stage button posts a tiny form and refreshes this region. */}
        <div {...style.attrs(crmStyles.card)}>
          <h2 {...style.attrs(crmStyles.sectionLabel)}>Move stage</h2>
          <div class="flex flex-wrap gap-2">
            {MOVE_STAGES.map((stage) => (
              <form key={`${deal.id}:${stage}`} {...mutationFormAttributes(moveDeal)}>
                {slots.request ? csrfField(slots.request, crmCsrf) : ''}
                <input type="hidden" name="dealId" value={deal.id} />
                <input type="hidden" name="stage" value={stage} />
                <button
                  type="submit"
                  disabled={deal.stage === stage || closed}
                  {...style.attrs(
                    crmStyles.stageButton,
                    deal.stage === stage ? crmStyles.stageButtonActive : false,
                  )}
                >
                  {stage}
                </button>
              </form>
            ))}
          </div>
          <div {...style.attrs(crmStyles.dividerTop)}>
            {closed ? (
              <p {...style.attrs(crmStyles.muted)}>
                This deal is closed ({deal.stage}). Commission is final.
              </p>
            ) : (
              <form key={`${deal.id}:close`} {...mutationFormAttributes(closeDeal)}>
                {slots.request ? csrfField(slots.request, crmCsrf) : ''}
                <input type="hidden" name="dealId" value={deal.id} />
                <button
                  type="submit"
                  {...style.attrs(crmStyles.stageButton, crmStyles.stageButtonActive)}
                >
                  Close won
                </button>
              </form>
            )}
          </div>
        </div>

        <section>
          <h2 {...style.attrs(crmStyles.sectionLabel)}>Activity</h2>
          {activities.length === 0 ? (
            <p {...style.attrs(crmStyles.formPanel, crmStyles.muted)}>
              No activity logged yet.
            </p>
          ) : (
            <ol class="space-y-2">
              {activities.map((activity) => (
                <li {...style.attrs(crmStyles.formPanel)}>
                  <p {...style.attrs(crmStyles.sectionLabel)}>
                    {activity.kind}
                  </p>
                  <p {...style.attrs(crmStyles.muted)}>{activity.note}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    );
  },
});
