import { describe, expect, it } from 'vitest';

import {
  evaluateProvenancePrecisionRegister,
  loadProvenancePrecisionRegisterInputs,
  precisionExtractorPath,
  precisionGeneratorPath,
} from './provenance-precision-register-gate.mjs';

function inputsWith({ document, sources } = {}) {
  const inputs = loadProvenancePrecisionRegisterInputs();
  return {
    document: document ?? structuredClone(inputs.document),
    sources: { ...inputs.sources, ...sources },
  };
}

describe('provenance precision-grant register gate (Plan 3 §4.5)', () => {
  it('accepts the exact extractor denominator and register-derived generator', () => {
    expect(
      evaluateProvenancePrecisionRegister(loadProvenancePrecisionRegisterInputs()),
    ).toMatchObject({ findings: [], ok: true, ownerless: 0, rows: 14 });
  });

  it('fails closed when an owner is removed', () => {
    const inputs = inputsWith();
    inputs.document.rows[0].owner = '';
    expect(evaluateProvenancePrecisionRegister(inputs)).toMatchObject({
      ok: false,
      ownerless: 1,
      findings: expect.arrayContaining([expect.stringContaining('ownerless')]),
    });
  });

  it('fails when a register row is deleted', () => {
    const inputs = inputsWith();
    inputs.document.rows.splice(4, 1);
    expect(evaluateProvenancePrecisionRegister(inputs)).toMatchObject({
      ok: false,
      findings: expect.arrayContaining([expect.stringContaining('extractor precision grants')]),
    });
  });

  it('fails when a generator claims an undeclared provenance state', () => {
    const inputs = inputsWith();
    inputs.document.rows[0].generatorExpectedProvenance = 'invented-safe-state';
    expect(evaluateProvenancePrecisionRegister(inputs)).toMatchObject({
      ok: false,
      findings: expect.arrayContaining([expect.stringContaining('declared concrete below-top')]),
    });
  });

  it('fails when a return bypasses or drifts from its reviewed grant', () => {
    const inputs = inputsWith();
    const source = inputs.sources[precisionExtractorPath];
    const mutated = source.replace(
      "serverPrecisionGrant('call-local', 'local')",
      "serverPrecisionGrant('call-local-drift', 'local')",
    );
    expect(mutated).not.toBe(source);
    expect(
      evaluateProvenancePrecisionRegister(
        inputsWith({ sources: { [precisionExtractorPath]: mutated } }),
      ),
    ).toMatchObject({
      ok: false,
      findings: expect.arrayContaining([expect.stringContaining('extractor precision grants')]),
    });

    const bypassed = source.replace("serverPrecisionGrant('call-local', 'local')", "'local'");
    expect(
      evaluateProvenancePrecisionRegister(
        inputsWith({ sources: { [precisionExtractorPath]: bypassed } }),
      ),
    ).toMatchObject({
      ok: false,
      findings: expect.arrayContaining([expect.stringContaining('below-top return')]),
    });
  });

  it('fails when the generator drops register derivation or an exact case', () => {
    const inputs = inputsWith();
    const source = inputs.sources[precisionGeneratorPath];
    const detached = source.replace(
      'serverProvenancePrecisionGrantRows.map',
      'serverProvenancePrecisionGrantRows.filter(() => true).map',
    );
    expect(detached).not.toBe(source);
    expect(
      evaluateProvenancePrecisionRegister(
        inputsWith({ sources: { [precisionGeneratorPath]: detached } }),
      ),
    ).toMatchObject({
      ok: false,
      findings: expect.arrayContaining([expect.stringContaining('register-derived generator')]),
    });

    const missingCase = source.replace("    case 'call-local':", "    case 'call-local-missing':");
    expect(
      evaluateProvenancePrecisionRegister(
        inputsWith({ sources: { [precisionGeneratorPath]: missingCase } }),
      ),
    ).toMatchObject({
      ok: false,
      findings: expect.arrayContaining([expect.stringContaining('generator cases')]),
    });
  });

  it('fails when final local precision loses a prerequisite', () => {
    const inputs = inputsWith();
    const finalRow = inputs.document.rows.find((row) => row.id === 'fallthrough-contained-local');
    finalRow.prerequisites.pop();
    expect(evaluateProvenancePrecisionRegister(inputs)).toMatchObject({
      ok: false,
      findings: expect.arrayContaining([
        expect.stringContaining('fallthrough-contained-local prerequisites'),
      ]),
    });
  });
});
