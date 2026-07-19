import { describe, expect, it } from 'vitest';

import {
  buildSecurityCoverageCells,
  evaluateSecurityCarrierGrammar,
  evaluateSecurityCoverageManifest,
} from './security-coverage.mjs';

const vocabulary = {
  browserOperationKinds: ['browser.state.read', 'browser.state.write'],
  closedVerdicts: ['opaque-transfer', 'unknown-operation'],
  rootKinds: ['application', 'route'],
  serverOperationKinds: ['server.handler.root'],
};

const corpora = [
  {
    id: 'finite-security-operation-ir',
    verdictAnchors: [
      { id: 'operation-witness', file: 'operation.test.ts', snippets: ['operation witness'] },
      { id: 'root-witness', file: 'root.test.ts', snippets: ['root witness'] },
      { id: 'closed-witness', file: 'closed.test.ts', snippets: ['closed witness'] },
    ],
  },
];

// @kovo-security-certifies C13 security-coverage-denominator-closure
it('derives one stable coverage cell per exact finite decision-surface member', () => {
  const cells = buildSecurityCoverageCells(vocabulary);
  expect(cells.map((cell) => cell.id)).toEqual([
    'browser-operation:browser.state.read',
    'browser-operation:browser.state.write',
    'server-operation:server.handler.root',
    'root:application',
    'root:route',
    'closed-verdict:opaque-transfer',
    'closed-verdict:unknown-operation',
  ]);

  const withScratchKind = buildSecurityCoverageCells({
    ...vocabulary,
    browserOperationKinds: [...vocabulary.browserOperationKinds, 'browser.scratch'],
  });
  expect(withScratchKind).toHaveLength(cells.length + 1);
  expect(withScratchKind.slice(0, cells.length)).toEqual(cells);
  expect(withScratchKind.at(-1)?.id).toBe('browser-operation:browser.scratch');
});

it('fails closed on missing, unknown, or unsubstantiated coverage cells', () => {
  const rows = buildSecurityCoverageCells(vocabulary).map((cell) => ({
    ...cell,
    disposition: 'witness',
    reason: null,
    review: null,
    witnesses: [
      {
        anchor: cell.surface === 'root' ? 'root-witness' : 'operation-witness',
        corpus: 'finite-security-operation-ir',
      },
    ],
  }));
  rows.at(-1).witnesses = [
    { anchor: 'closed-witness', corpus: 'finite-security-operation-ir' },
  ];
  rows.splice(1, 1);
  rows.push({
    disposition: 'inapplicable',
    id: 'root:invented',
    reason: '',
    review: null,
    surface: 'root',
    value: 'invented',
    witnesses: [],
  });

  const result = evaluateSecurityCoverageManifest({
    corpora,
    document: { cells: rows, schema: 'kovo-security-coverage/v1' },
    vocabulary,
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([
      'missing coverage cell browser-operation:browser.state.write',
      'unknown coverage cell root:invented',
      'root:invented: inapplicable coverage requires a substantive reason and reviewed decision',
    ]),
  );
});

// @kovo-security-certifies C13 historical-classifier-anchor-carrier-grammar
it('maps every historical classifier anchor through one closed carrier production', () => {
  const document = {
    mappings: [
      {
        anchor: 'operation-witness',
        corpus: 'finite-security-operation-ir',
        production: 'exact-operation',
        reason: 'Direct finite-operation witness.',
      },
      {
        anchor: 'root-witness',
        corpus: 'finite-security-operation-ir',
        production: 'root-registration',
        reason: 'Exact root registration witness.',
      },
      {
        anchor: 'closed-witness',
        corpus: 'finite-security-operation-ir',
        production: 'closed-verdict',
        reason: 'Exact fail-closed verdict witness.',
      },
    ],
    productions: [
      { id: 'exact-operation', meaning: 'Direct finite operation.' },
      { id: 'root-registration', meaning: 'Root registration or rejection.' },
      { id: 'closed-verdict', meaning: 'Named closed verdict.' },
    ],
    schema: 'kovo-security-carrier-grammar/v1',
  };

  expect(evaluateSecurityCarrierGrammar({ corpora, document }).findings).toEqual([]);
  const missingHistoricalAnchor = {
    ...document,
    mappings: document.mappings.slice(1),
  };
  expect(
    evaluateSecurityCarrierGrammar({ corpora, document: missingHistoricalAnchor }).findings,
  ).toContain(
    'missing historical witness mapping finite-security-operation-ir:operation-witness',
  );
});

describe('reviewed inapplicable cells', () => {
  it('accepts only a substantive reason with an explicit review identity', () => {
    const cells = buildSecurityCoverageCells(vocabulary).map((cell) => ({
      ...cell,
      disposition: 'witness',
      reason: null,
      review: null,
      witnesses: [
        { anchor: 'operation-witness', corpus: 'finite-security-operation-ir' },
      ],
    }));
    cells[0] = {
      ...cells[0],
      disposition: 'inapplicable',
      reason: 'The deferred root has no shipping constructor in the reviewed public surface.',
      review: { id: 'DEC-COV-1', basis: 'packages/compiler/src/capability-closure.security.test.ts' },
      witnesses: [],
    };

    expect(
      evaluateSecurityCoverageManifest({
        corpora,
        document: { cells, schema: 'kovo-security-coverage/v1' },
        vocabulary,
      }).findings,
    ).toEqual([]);
  });
});
