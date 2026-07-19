// @kovo-security-classifier-corpus finite-security-operation-ir
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

interface AnalyzableFragmentRow {
  readonly classification: 'BUDGETED' | 'DELIBERATE' | 'FUNDAMENTAL';
  readonly closedReason: string;
  readonly id: string;
  readonly witness: { readonly file: string };
}

interface BudgetBindingRow {
  readonly bindingRoots: readonly string[];
  readonly id: 'callDepth' | 'nodes' | 'operations' | 'summaries';
  readonly reason: string;
}

interface AnalyzableFragmentDocument {
  readonly budgetBindingMeasurement: {
    readonly budgets: readonly BudgetBindingRow[];
    readonly corpus: { readonly files: readonly string[]; readonly rootCount: number };
  };
  readonly prohibitions: readonly AnalyzableFragmentRow[];
}

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const ledger = JSON.parse(
  readFileSync(path.join(repoRoot, 'security/analyzable-fragment.json'), 'utf8'),
) as AnalyzableFragmentDocument;

const expectedProhibitionIds = [
  'arguments-rest-spread-recovery',
  'call-apply-bind',
  'foreign-callable',
  'mutable-ambiguous-join',
  'mutating-authority-alias',
  'opaque-container',
  'returning-authority',
  'throwing-authority',
  'unsummarized-nested-callable',
] as const;

function compile(fileName: string, source: string) {
  return compileComponentModule({ fileName, source });
}

describe('SPEC §6.6 analyzable-fragment witnesses', () => {
  // @kovo-security-certifies C13 analyzable-fragment-emitted-kv449-closure
  it('proves every ledger witness by compiling it to its emitted KV449 closed reason', () => {
    expect(ledger.prohibitions.map(({ id }) => id).sort()).toEqual(expectedProhibitionIds);

    for (const row of ledger.prohibitions) {
      const source = readFileSync(path.join(repoRoot, row.witness.file), 'utf8');
      const result = compile(row.witness.file, source);
      const closedVerdict = `verdict=closed:${row.closedReason}`;
      const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449');
      const traces = result.componentGraphFacts.flatMap(
        (fact) => fact.securitySemanticGraph?.roots.flatMap((root) => root.traces) ?? [],
      );

      expect(
        diagnostics.some((diagnostic) => diagnostic.message.includes(closedVerdict)),
        `${row.id} did not emit KV449 with ${closedVerdict}`,
      ).toBe(true);
      expect(
        traces.some(
          (trace) => trace.verdict === 'closed' && trace.reason === row.closedReason,
        ),
        `${row.id} did not retain ${row.closedReason} in the semantic graph`,
      ).toBe(true);
    }
  });

  // @kovo-security-certifies C13 analyzable-fragment-real-root-budget-binding
  it('measures every named semantic budget against the checked real-root corpus', () => {
    const bindingRoots = new Map<string, Set<string>>(
      ledger.budgetBindingMeasurement.budgets.map(({ reason }) => [reason, new Set()]),
    );
    let rootCount = 0;

    for (const fileName of ledger.budgetBindingMeasurement.corpus.files) {
      const source = readFileSync(path.join(repoRoot, fileName), 'utf8');
      const result = compile(fileName, source);
      const roots = result.componentGraphFacts.flatMap(
        (fact) => fact.securitySemanticGraph?.roots ?? [],
      );
      rootCount += roots.length;
      for (const root of roots) {
        for (const trace of root.traces) {
          if (trace.verdict !== 'closed' || trace.reason === undefined) continue;
          bindingRoots.get(trace.reason)?.add(`${fileName}#${root.root}`);
        }
      }
    }

    expect(rootCount).toBe(ledger.budgetBindingMeasurement.corpus.rootCount);
    for (const budget of ledger.budgetBindingMeasurement.budgets) {
      expect([...bindingRoots.get(budget.reason) ?? []].sort(), budget.id).toEqual(
        budget.bindingRoots,
      );
    }
  });
});
