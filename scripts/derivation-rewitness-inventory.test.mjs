import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './lib/repo-root.mjs';
import {
  loadSecurityDenominatorInventories,
  validateSecurityDenominatorInventories,
} from './derivation-rewitness-inventory.mjs';

const inventoryPath = path.join(
  repoRoot(),
  'security/security-derivation-rewitness-inventory.json',
);

describe('security derivation and re-witness denominator inventories', () => {
  it('freezes the current stable-ID denominators and reports absolute uncovered counts', () => {
    const result = loadSecurityDenominatorInventories();
    expect(result).toEqual({
      findings: [],
      ok: true,
      summary: {
        derivation: {
          checkedIntent: 0,
          derived: 2,
          reviewedExempt: 0,
          total: 8,
          uncovered: 6,
        },
        rewitness: {
          reviewedExempt: 0,
          rewitnessed: 3,
          total: 9,
          uncovered: 6,
        },
      },
    });
  });

  it('kills deletion, insertion, duplication, and reordering of frozen stable IDs', () => {
    const deleted = inventoryDocument();
    deleted.derivation.rows.splice(0, 1);
    expect(validateSecurityDenominatorInventories(deleted).findings).toContainEqual(
      expect.stringContaining('missing frozen stable ID D.browser-posture'),
    );

    const inserted = inventoryDocument();
    inserted.derivation.rows.push({ ...inserted.derivation.rows.at(-1), id: 'D.scratch' });
    expect(validateSecurityDenominatorInventories(inserted).findings).toContainEqual(
      expect.stringContaining('D.scratch is not enrolled'),
    );

    const duplicated = inventoryDocument();
    duplicated.rewitness.rows[1].id = duplicated.rewitness.rows[0].id;
    expect(validateSecurityDenominatorInventories(duplicated).findings).toContainEqual(
      expect.stringContaining('duplicate stable ID W.async-context-lifecycle'),
    );

    const reordered = inventoryDocument();
    [reordered.derivation.rows[0], reordered.derivation.rows[1]] = [
      reordered.derivation.rows[1],
      reordered.derivation.rows[0],
    ];
    expect(validateSecurityDenominatorInventories(reordered).findings).toContainEqual(
      expect.stringContaining('rows must be sorted by stable ID'),
    );
  });

  it('kills false covered claims and missing re-witness cost or freshness evidence', () => {
    const falseDerivation = inventoryDocument();
    falseDerivation.derivation.rows.find(
      (row) => row.id === 'D.config-secret-classification',
    ).proof = [];
    expect(validateSecurityDenominatorInventories(falseDerivation).findings).toContainEqual(
      expect.stringContaining('derived obligations require proof evidence'),
    );

    const falseRewitness = inventoryDocument();
    const rewitnessed = falseRewitness.rewitness.rows.find(
      (row) => row.id === 'W.config-secret-runtime-box',
    );
    rewitnessed.evidence = [];
    rewitnessed.costBudget = '';
    const findings = validateSecurityDenominatorInventories(falseRewitness).findings;
    expect(findings).toContainEqual(
      expect.stringContaining('rewitnessed obligations require current evidence'),
    );
    expect(findings).toContainEqual(expect.stringContaining('costBudget must be non-empty'));
  });

  it('requires an explicit reviewed raise and killing mutation for inapplicable obligations', () => {
    const unreviewed = inventoryDocument();
    const row = unreviewed.derivation.rows[0];
    row.applicability = 'inapplicable';
    row.status = 'reviewed-exempt';
    expect(validateSecurityDenominatorInventories(unreviewed).findings).toContainEqual(
      expect.stringContaining('must record the reviewed raise and killing mutation'),
    );

    row.reviewedExemption = {
      marker: 'SECURITY-REVIEWED-RAISE',
      mutationEvidence: ['drop-browser-posture-obligation'],
      owner: 'security architecture reviewer',
      reason: 'the supported browser posture was deliberately removed',
    };
    expect(validateSecurityDenominatorInventories(unreviewed)).toMatchObject({
      findings: [],
      ok: true,
      summary: {
        derivation: { reviewedExempt: 1, total: 8, uncovered: 5 },
      },
    });
  });

  it('kills weakening either denominator policy bit', () => {
    const document = inventoryDocument();
    document.denominatorPolicy.stableIdsNeverRemoved = false;
    document.denominatorPolicy.inapplicableRequiresReviewedMarkerAndMutation = false;
    expect(validateSecurityDenominatorInventories(document).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('stableIdsNeverRemoved must be true'),
        expect.stringContaining('inapplicableRequiresReviewedMarkerAndMutation must be true'),
      ]),
    );
  });
});

function inventoryDocument() {
  return JSON.parse(readFileSync(inventoryPath, 'utf8'));
}
