import { describe, expect, it } from 'vitest';

import { compileCompilerEmittedFixture as compileComponentModule } from './test-support.js';

describe('query plan ownership', () => {
  it('rejects two aliases for one source-derived runtime query in a component', () => {
    const result = compileComponentModule({
      fileName: 'src/components/deal-card.tsx',
      source: `
import {
  dealByIdQuery,
  dealByIdQuery as selectedDealQuery,
} from '../queries/deal-by-id.ts';

export const DealCard = component({
  queries: {
    deal: dealByIdQuery,
    selectedDeal: selectedDealQuery,
  },
  render: ({ deal, selectedDeal }) => (
    <article>
      <span data-bind="deal.stage">{deal.stage}</span>
      <span data-bind="selectedDeal.stage">{selectedDeal.stage}</span>
    </article>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV240',
          message: expect.stringContaining(
            'Duplicate component query binding. component="DealCard" runtime query="queries/deal-by-id/deal-by-id-query"',
          ),
          severity: 'error',
        }),
      ]),
    );
  });

  it('accepts distinct source-derived runtime queries in one component', () => {
    const result = compileComponentModule({
      fileName: 'src/components/deal-card.tsx',
      source: `
import { dealByIdQuery, pipelineQuery } from '../queries/deals.ts';

export const DealCard = component({
  queries: {
    deal: dealByIdQuery,
    pipeline: pipelineQuery,
  },
  render: ({ deal, pipeline }) => (
    <article>
      <span data-bind="deal.stage">{deal.stage}</span>
      <span data-bind="pipeline.count">{pipeline.count}</span>
    </article>
  ),
});
`,
    });

    expect(
      result.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === 'KV240' &&
          diagnostic.message.includes('Duplicate component query binding'),
      ),
    ).toEqual([]);
  });

  it('rejects a duplicate component query alias even when the runtime queries differ', () => {
    const result = compileComponentModule({
      fileName: 'src/components/deal-card.tsx',
      source: `
import { dealByIdQuery, pipelineQuery } from '../queries/deals.ts';

export const DealCard = component({
  queries: {
    deal: dealByIdQuery,
    deal: pipelineQuery,
  },
  render: ({ deal }) => <span data-bind="deal.stage">{deal.stage}</span>,
});
`,
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV240',
          message: expect.stringContaining(
            'Duplicate component query binding. component="DealCard" component alias="deal" aliases=deal, deal',
          ),
          severity: 'error',
        }),
      ]),
    );
  });

  it('emits full plan ownership for force-off query roots without live refresh authority', () => {
    const result = compileComponentModule({
      fileName: 'src/components/deal-card.tsx',
      source: `
import { dealByIdQuery } from '../queries/deal-by-id.ts';

export const DealCard = component({
  disableServerRefresh: true,
  queries: { deal: dealByIdQuery },
  render: ({ deal }) => (
    <article><span data-bind="deal.stage">{deal.stage}</span></article>
  ),
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(serverSource).toContain('kovo-c="deal-card"');
    expect(serverSource).toContain('kovo-plan-owner="components/deal-card/deal-card"');
    expect(serverSource).toContain('kovo-deps=');
    expect(serverSource).not.toContain('kovo-fragment-target=');
    expect(serverSource).not.toContain('kovo-live-component=');
    expect(result.queryPlanBootstrapMetadata).toEqual(
      expect.objectContaining({
        componentName: 'components/deal-card/deal-card',
        exportName: 'DealCard$queryUpdatePlans',
      }),
    );
  });
});
