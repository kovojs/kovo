/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { csrfField, mutationFormAttributes } from '@kovojs/server';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';
import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';
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

const pipelineStyles = style.create(
  {
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
    formGrid: {
      display: 'grid',
      gap: 8,
      '@media (min-width: 640px)': {
        alignItems: 'start',
        gridTemplateColumns: '1fr auto 1fr auto',
      },
    },
    formPanel: {
      backgroundColor: tokens.sys.color.surfaceContainerLowest,
      borderColor: tokens.sys.color.outlineVariant,
      borderRadius: tokens.sys.shape.cornerMedium,
      borderStyle: 'solid',
      borderWidth: 1,
      padding: 16,
    },
    heading: {
      color: tokens.sys.color.onSurface,
      fontSize: 24,
      fontWeight: 700,
      letterSpacing: 0,
      lineHeight: 1.25,
      margin: 0,
    },
    input: {
      backgroundColor: tokens.sys.color.surfaceContainerLowest,
      borderColor: tokens.sys.color.outline,
      borderRadius: tokens.sys.shape.cornerSmall,
      borderStyle: 'solid',
      borderWidth: 1,
      boxSizing: 'border-box',
      color: tokens.sys.color.onSurface,
      fontSize: 14,
      paddingBlock: 8,
      paddingInline: 12,
      width: '100%',
    },
    muted: {
      color: tokens.sys.color.onSurfaceVariant,
      fontSize: 14,
    },
    sectionLabel: {
      color: tokens.sys.color.onSurfaceVariant,
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: '0.025em',
      marginBlockEnd: 12,
      textTransform: 'uppercase',
    },
    stackLg: {
      display: 'grid',
      gap: 32,
    },
    stackSm: {
      display: 'grid',
      gap: 4,
    },
    stageGrid: {
      display: 'grid',
      gap: 12,
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      '@media (min-width: 640px)': {
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      },
      '@media (min-width: 1024px)': {
        gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
      },
    },
    stageText: {
      textTransform: 'capitalize',
    },
    tabular: {
      fontVariantNumeric: 'tabular-nums',
    },
    tabularStrong: {
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 600,
    },
  },
  { namespace: 'crm-pipeline', source: 'examples/crm/src/components/pipeline.tsx' },
);

export const pipelineStyleCss = style.emitAtomicCss(
  Object.values(pipelineStyles).flatMap((entry) => entry.__rules ?? []),
);

interface PipelineRenderSlots {
  request?: CrmRequest | undefined;
}

function renderStageCard(bucket: PipelineStageBucket): string {
  return Card.definition.render({
    children: (
      <div style={pipelineStyles.stackSm}>
        <div>{stageBadge(bucket.stage)}</div>
        <p style={pipelineStyles.tabularStrong}>{money(bucket.total)}</p>
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
                style={pipelineStyles.backLink}
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
            children: <span style={pipelineStyles.tabular}>{money(deal.amount)}</span>,
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
  render: (
    {
      contactList,
      openDeals,
      pipelineByStage,
    }: {
      contactList: ContactListResult;
      openDeals: OpenDealsResult;
      pipelineByStage: PipelineByStageResult;
    },
    _state,
    slots: PipelineRenderSlots = {},
  ) => {
    const contacts = contactList.items;
    const buckets = pipelineByStage.buckets;
    const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
    const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);

    return (
      <div style={pipelineStyles.stackLg}>
        <div>
          <h1 style={pipelineStyles.heading}>Sales pipeline</h1>
          <p style={pipelineStyles.muted}>
            {money(total)} across {buckets.length} stages, <span>{openDeals.items.length}</span>{' '}
            deals open now.
          </p>
        </div>

        <section>
          <h2 style={pipelineStyles.sectionLabel}>By stage</h2>
          <div style={pipelineStyles.stageGrid}>
            {buckets.map((bucket) => renderStageCard(bucket))}
          </div>
        </section>

        {/* The refreshed fragment resets the form with a fresh deal id. */}
        <section>
          <h2 style={pipelineStyles.sectionLabel}>New deal</h2>
          <form
            {...mutationFormAttributes(createDeal)}
            style={pipelineStyles.formPanel}
          >
            {slots.request ? csrfField(slots.request, crmCsrf) : ''}
            <input type="hidden" name="id" value={freshId('d')} />
            <input type="hidden" name="ownerId" value="u1" />
            <div style={pipelineStyles.formGrid}>
              <select
                name="contactId"
                required
                style={pipelineStyles.input}
              >
                {contacts.map((contact) => (
                  <option value={contact.id}>{contact.name}</option>
                ))}
              </select>
              <select
                name="stage"
                style={[pipelineStyles.input, pipelineStyles.stageText]}
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
                style={pipelineStyles.input}
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
          <h2 style={pipelineStyles.sectionLabel}>Open deals</h2>
          {renderOpenDealsTable(openDeals.items, contactsById)}
        </section>
      </div>
    );
  },
});
