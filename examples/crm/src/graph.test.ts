import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { KovoExplainInput } from '@kovojs/core/internal/graph';
import { kovoCheck, kovoExplain } from '@kovojs/cli';
import { describe, expect, it } from 'vitest';

const crmRoot = fileURLToPath(new URL('..', import.meta.url));
const graph = JSON.parse(
  readFileSync(join(crmRoot, 'src/generated/graph.json'), 'utf8'),
) as KovoExplainInput;

describe('CRM generated graph', () => {
  it('passes kovo check', () => {
    const result = kovoCheck(graph);
    expect(result.exitCode).toBe(0);
  });

  it('keeps the intentional optimistic mix visible', () => {
    expect(statusesFor('createDeal')).toEqual({
      contactDealCount: 'derived',
      contactList: 'hand-written',
      dealList: 'derived',
      openDeals: 'derived',
      pipelineByStage: 'hand-written',
    });
    expect(statusesFor('moveDeal')).toMatchObject({
      openDeals: 'await-fragment',
      pipelineByStage: 'await-fragment',
    });

    const moveExplain = kovoExplain(graph, {
      kind: 'mutation',
      optimistic: true,
      target: 'moveDeal',
    });
    expect(moveExplain.output).toContain('OPTIMISTIC-PUNT openDeals: membership entry: stage');
  });
});

function statusesFor(mutation: string): Record<string, string> {
  return Object.fromEntries(
    (graph.optimistic ?? [])
      .filter((entry) => entry.mutation === mutation)
      .map((entry) => [entry.query, entry.status]),
  );
}
