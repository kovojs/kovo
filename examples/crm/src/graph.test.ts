import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import type { FwExplainInput } from '@jiso/core';
import { fwCheckOkAssertionFact } from '@jiso/test/fw-check-fixtures';
import { fwExplainMutationAssertionFact } from '@jiso/test/fw-explain-fixtures';
import { graphOptimisticStatusMatrix, type JisoGraphFixture } from '@jiso/test/graph-fixtures';
import { fwCheck, fwExplain } from 'fw';
import { describe, expect, it } from 'vitest';

// SPEC.md §10.4/§10.5/§10.6/§16.5: the CRM graph is the mechanical proof of the
// optimism MIX. `fw check` must be OK (zero unhandled FW310 — every invalidated
// pair carries an explicit status). `fw explain --optimistic` must show, per
// mutation, the partition of `derived` / `hand-written` / `await-fragment` pairs
// plus the named PUNTED derivation reasons rendered inline for the
// punted-but-overridden pairs. We assert against the committed generated
// graph.json so the test pins the same artifact the app and `emit-graph --check`
// consume.

const crmRoot = fileURLToPath(new URL('..', import.meta.url));
const graph = JSON.parse(
  readFileSync(join(crmRoot, 'src/generated/graph.json'), 'utf8'),
) as FwExplainInput;

describe('CRM source-truth graph: derived + hand-written + await-fragment MIX', () => {
  it('fw check is OK (zero unhandled FW310) — every invalidated pair is covered', () => {
    expect(fwCheckOkAssertionFact(fwCheck(graph))).toEqual({
      exitCode: 0,
      issueCount: 0,
      status: 'ok',
      version: 'fw-check/v1',
    });
  });

  it('fw explain --optimistic shows the full mix per mutation (with named PUNTED reasons)', () => {
    const explainFor = (mutation: string) =>
      fwExplainMutationAssertionFact(
        fwExplain(graph, { kind: 'mutation', optimistic: true, target: mutation }),
      );

    // addContact: a single fully-derived pair (the all-derived baseline).
    expect(explainFor('addContact').optimisticStatuses).toEqual({ contactList: 'derived' });
    expect(explainFor('addContact').optimisticSummary).toEqual({
      PUNTED: '0',
      UNHANDLED: '0',
      'await-fragment': '0',
      derived: '1',
      'hand-written': '0',
      total: '1',
    });

    // createDeal: 3 derived + 2 hand-written; one of the hand-written pairs is a
    // named GROUP BY PUNT (pipelineByStage).
    expect(explainFor('createDeal').optimisticStatuses).toEqual({
      contactDealCount: 'derived',
      contactList: 'hand-written',
      dealList: 'derived',
      openDeals: 'derived',
      pipelineByStage: 'hand-written',
    });
    expect(explainFor('createDeal').optimisticSummary).toEqual({
      PUNTED: '1',
      UNHANDLED: '0',
      'await-fragment': '0',
      derived: '3',
      'hand-written': '2',
      total: '5',
    });

    // moveDeal: 2 derived + 2 await-fragment (membership-entry + GROUP BY punts).
    expect(explainFor('moveDeal').optimisticStatuses).toEqual({
      contactDealCount: 'derived',
      dealList: 'derived',
      openDeals: 'await-fragment',
      pipelineByStage: 'await-fragment',
    });
    expect(explainFor('moveDeal').optimisticSummary).toEqual({
      PUNTED: '2',
      UNHANDLED: '0',
      'await-fragment': '2',
      derived: '2',
      'hand-written': '0',
      total: '4',
    });

    // closeDeal: 1 derived + 1 hand-written + 2 await-fragment (opaque commission
    // + GROUP BY). openDeals is hand-written (sound remove-row despite opacity).
    expect(explainFor('closeDeal').optimisticStatuses).toEqual({
      contactDealCount: 'derived',
      dealList: 'await-fragment',
      openDeals: 'hand-written',
      pipelineByStage: 'await-fragment',
    });
    expect(explainFor('closeDeal').optimisticSummary).toEqual({
      PUNTED: '1',
      UNHANDLED: '0',
      'await-fragment': '2',
      derived: '1',
      'hand-written': '1',
      total: '4',
    });
  });

  it('renders the named PUNTED derivation reasons inline (group-by-having, membership-entry)', () => {
    const moveExplain = fwExplain(graph, {
      kind: 'mutation',
      optimistic: true,
      target: 'moveDeal',
    });
    expect(moveExplain.output).toContain('OPTIMISTIC-PUNT openDeals: membership entry: stage');
    expect(moveExplain.output).toContain('OPTIMISTIC-PUNT pipelineByStage: group-by-having shape');

    const createExplain = fwExplain(graph, {
      kind: 'mutation',
      optimistic: true,
      target: 'createDeal',
    });
    expect(createExplain.output).toContain(
      'OPTIMISTIC-PUNT pipelineByStage: group-by-having shape',
    );
  });

  it('answers the full mutation × query optimism matrix mechanically from the graph', () => {
    expect(graphOptimisticStatusMatrix(graph as JisoGraphFixture)).toEqual({
      addContact: {
        contactList: 'derived',
        contactDealCount: 'no-invalidation',
        dealList: 'no-invalidation',
        openDeals: 'no-invalidation',
        pipelineByStage: 'no-invalidation',
      },
      createDeal: {
        contactList: 'hand-written',
        contactDealCount: 'derived',
        dealList: 'derived',
        openDeals: 'derived',
        pipelineByStage: 'hand-written',
      },
      moveDeal: {
        contactList: 'no-invalidation',
        contactDealCount: 'derived',
        dealList: 'derived',
        openDeals: 'await-fragment',
        pipelineByStage: 'await-fragment',
      },
      closeDeal: {
        contactList: 'no-invalidation',
        contactDealCount: 'derived',
        dealList: 'await-fragment',
        openDeals: 'hand-written',
        pipelineByStage: 'await-fragment',
      },
    });
  });
});
