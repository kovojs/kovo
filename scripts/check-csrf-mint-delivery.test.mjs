import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  defaultCsrfMintDeliveryPath,
  validateCsrfMintDeliveryDocument,
} from './check-csrf-mint-delivery.mjs';
import { repoRoot } from './lib/repo-root.mjs';

function matrix() {
  return JSON.parse(readFileSync(`${repoRoot()}/${defaultCsrfMintDeliveryPath}`, 'utf8'));
}

function surface(document, id) {
  return document.surfaces.find((entry) => entry.id === id);
}

describe('CSRF mint/deliver/validate/rotate/replay matrix', () => {
  it('closes every lifecycle surface over live proof anchors', () => {
    const result = validateCsrfMintDeliveryDocument(matrix(), { checkProofs: true });

    expect(result).toMatchObject({
      ok: true,
      summary: { canaryCount: 6, surfaceCount: 18 },
    });
  });

  it('kills a lifecycle-receipt deletion mutant', () => {
    const mutant = matrix();
    surface(mutant, 'anonymous-document-bootstrap').deliver = 'existing-binding';

    expect(validateCsrfMintDeliveryDocument(mutant).findings).toContain(
      `${defaultCsrfMintDeliveryPath}: anonymous-document-bootstrap.deliver must be response-lifecycle`,
    );
  });

  it('kills a partial public mutation-helper mutant', () => {
    const mutant = matrix();
    surface(mutant, 'typed-mutation-form').replay = 'protocol-owned';

    expect(validateCsrfMintDeliveryDocument(mutant).findings).toContain(
      `${defaultCsrfMintDeliveryPath}: typed-mutation-form.replay must be idem-deduplicated`,
    );
  });

  it('kills header-seal and cache-posture mutants', () => {
    const mutant = matrix();
    surface(mutant, 'late-stream').deliver = 'response-lifecycle';
    surface(mutant, 'cache-posture').deliver = 'response-lifecycle';
    const findings = validateCsrfMintDeliveryDocument(mutant).findings;

    expect(findings).toEqual(
      expect.arrayContaining([
        `${defaultCsrfMintDeliveryPath}: late-stream.deliver must be forbidden-after-seal`,
        `${defaultCsrfMintDeliveryPath}: cache-posture.deliver must be private-no-store-cookie-vary`,
      ]),
    );
  });

  it('kills rotation and replay-order mutants', () => {
    const mutant = matrix();
    surface(mutant, 'session-rotation').rotate = 'not-applicable';
    surface(mutant, 'mutation-replay').validate = 'exact-ingress-audience';
    const findings = validateCsrfMintDeliveryDocument(mutant).findings;

    expect(findings).toEqual(
      expect.arrayContaining([
        `${defaultCsrfMintDeliveryPath}: session-rotation.rotate must be old-rejected-new-required`,
        `${defaultCsrfMintDeliveryPath}: mutation-replay.validate must be before-replay`,
      ]),
    );
  });

  it('rejects denominator shrinkage, missing canaries, and stale proof anchors', () => {
    const mutant = matrix();
    mutant.surfaces = mutant.surfaces.filter((entry) => entry.id !== 'query-channel');
    mutant.canaries = mutant.canaries.filter((entry) => entry.id !== 'drop-header-seal');
    surface(mutant, 'packed-node-vercel').proof.anchor = 'missing packed proof';
    const findings = validateCsrfMintDeliveryDocument(mutant, { checkProofs: true }).findings;

    expect(findings.some((finding) => finding.includes('surface ids must equal'))).toBe(true);
    expect(findings.some((finding) => finding.includes('canary ids must equal'))).toBe(true);
    expect(findings.some((finding) => finding.includes('anchor is stale'))).toBe(true);
  });
});
