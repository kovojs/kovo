import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ESCAPE_CENSUS_DOORS } from './escape-census-gate.mjs';
import {
  ESCAPE_CENSUS_BASELINE_COMMAND,
  verifyEscapeCensusBaseline,
} from './escape-census-baseline.mjs';

const repoRoot = process.cwd();
const baseline = JSON.parse(
  readFileSync(resolve(repoRoot, 'security/escape-census-baseline.json'), 'utf8'),
);
const budgets = JSON.parse(readFileSync(resolve(repoRoot, 'security/escape-budgets.json'), 'utf8'));
const previousBudgets = JSON.parse(
  readFileSync(resolve(repoRoot, 'security/escape-budgets.previous.json'), 'utf8'),
);

function representativeGraph() {
  return {
    components: [],
    escapeCensus: {
      doors: ESCAPE_CENSUS_DOORS,
      schema: 'kovo.escape-census-coverage/v1',
      sources: {
        allowControlChars: 'trustEscapes',
        'csrf:false': 'trustEscapes',
        'ctx.fetch': 'securitySemanticGraph',
        kovoAnalyzerSummary: 'trustEscapes',
        trustedHtml: 'trustEscapes',
        trustedSql: 'trustEscapes',
      },
    },
    mutations: [
      {
        csrf: 'exempt',
        csrfJustification: 'non-browser Metric E representative app',
        key: 'admin/update',
      },
    ],
    trustEscapes: [
      { kind: 'allowControlChars', root: 'app.mjs:17', site: 'app.mjs:17' },
      { kind: 'csrfFalse', root: 'mutation:admin/update', site: 'app.mjs:14' },
      { kind: 'trustedHtml', root: 'app.mjs:31', site: 'app.mjs:31' },
    ],
  };
}

function representativeInputs() {
  return {
    apps: [
      {
        app: 'metric-e-representative',
        graph: representativeGraph(),
        package: '@kovojs/security-metric-e-app',
      },
    ],
    budgets: structuredClone(budgets),
    previousBudgets: structuredClone(previousBudgets),
  };
}

describe('persisted Metric E real-app baseline', () => {
  it('pins the exact command, report, and mandatory negative-control membership', () => {
    expect(baseline.command).toBe(ESCAPE_CENSUS_BASELINE_COMMAND);
    expect(() =>
      verifyEscapeCensusBaseline({ baseline, inputs: representativeInputs() }),
    ).not.toThrow();
  });

  it('rejects a representative app whose observed roots exceed the persisted budget', () => {
    const inputs = representativeInputs();
    inputs.budgets.packages['@kovojs/security-metric-e-app'].trustedHtml = 0;

    expect(() => verifyEscapeCensusBaseline({ baseline, inputs })).toThrow(
      '@kovojs/security-metric-e-app: trustedHtml escaped roots 1 exceed budget 0',
    );
  });

  it('rejects missing or forged producer provenance before accepting the report', () => {
    const missing = representativeInputs();
    delete missing.apps[0].graph.escapeCensus;
    expect(() => verifyEscapeCensusBaseline({ baseline, inputs: missing })).toThrow(
      'missing kovo.escape-census-coverage/v1 producer witness',
    );

    const forged = representativeInputs();
    forged.apps[0].graph.escapeCensus.sources.trustedHtml = 'unreviewed-producer';
    expect(() => verifyEscapeCensusBaseline({ baseline, inputs: forged })).toThrow(
      'escape-census door trustedHtml must derive from trustEscapes',
    );
  });

  it('rejects a rewritten baseline command or weakened negative-control expectation', () => {
    expect(() =>
      verifyEscapeCensusBaseline({
        baseline: { ...baseline, command: 'node scripts/escape-census-gate.mjs' },
        inputs: representativeInputs(),
      }),
    ).toThrow('baseline command drifted');

    const weakened = structuredClone(baseline);
    weakened.negativeChecks[0].expectedFindings = [];
    expect(() =>
      verifyEscapeCensusBaseline({ baseline: weakened, inputs: representativeInputs() }),
    ).toThrow('negative check budget-ceiling drifted');
  });
});
