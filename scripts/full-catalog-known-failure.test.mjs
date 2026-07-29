import { describe, expect, it } from 'vitest';

import { fullCatalogOutcome } from './lib/known-failure-probe-classifier.mjs';

describe('full-catalog known-failure classifier', () => {
  it('accepts only a complete under-budget packed proof as desired behavior', () => {
    expect(
      fullCatalogOutcome({
        functionalPass: true,
        budget: { thresholdBytes: 2_000, withinThreshold: true },
        copiedComponents: 44,
        unimportedDuringProof: true,
      }),
    ).toBe('desired-behavior');
    expect(
      fullCatalogOutcome({
        functionalPass: true,
        budget: { thresholdBytes: 2_000, withinThreshold: true },
        copiedComponents: 43,
        unimportedDuringProof: true,
      }),
    ).toBeNull();
  });

  it('reproduces only an observed budget breach or recognized OOM in a proof phase', () => {
    expect(
      fullCatalogOutcome({
        functionalPass: true,
        budget: { thresholdBytes: 2_000, withinThreshold: false },
        copiedComponents: 44,
        unimportedDuringProof: true,
      }),
    ).toBe('defect-reproduced');
    expect(
      fullCatalogOutcome({
        functionalPass: false,
        failure: { message: 'FATAL ERROR: heap out of memory', phase: 'check' },
        peakProcessTreeRssBytes: 1_500,
        budget: { thresholdBytes: 2_000 },
        copiedComponents: 44,
        unimportedDuringProof: true,
      }),
    ).toBe('defect-reproduced');
    expect(
      fullCatalogOutcome({
        functionalPass: false,
        failure: { message: 'KV417 classifier setup is missing', phase: 'check' },
        peakProcessTreeRssBytes: 1_500,
        budget: { thresholdBytes: 2_000 },
        copiedComponents: 44,
        unimportedDuringProof: true,
      }),
    ).toBeNull();
    expect(
      fullCatalogOutcome({
        functionalPass: false,
        failure: { message: 'exit=null signal=SIGKILL; command exceeded 600000ms', phase: 'check' },
        peakProcessTreeRssBytes: 1_500,
        budget: { thresholdBytes: 2_000 },
        copiedComponents: 44,
        unimportedDuringProof: true,
      }),
    ).toBeNull();
    expect(
      fullCatalogOutcome({
        functionalPass: false,
        failure: { message: 'exit=null signal=SIGKILL; command exceeded 600000ms', phase: 'check' },
        peakProcessTreeRssBytes: 2_500,
        budget: { thresholdBytes: 2_000 },
        copiedComponents: 44,
        unimportedDuringProof: true,
      }),
    ).toBeNull();
    expect(
      fullCatalogOutcome({
        functionalPass: false,
        failure: {
          message: 'ERROR KV448 installed implementation digest does not match',
          phase: 'check',
        },
        peakProcessTreeRssBytes: 5_980,
        budget: { thresholdBytes: 2_000 },
        copiedComponents: 44,
        unimportedDuringProof: true,
      }),
    ).toBeNull();
    expect(
      fullCatalogOutcome({
        functionalPass: false,
        failure: { message: 'heap out of memory', phase: 'install' },
        peakProcessTreeRssBytes: 3_000,
        budget: { thresholdBytes: 2_000 },
        copiedComponents: 44,
        unimportedDuringProof: true,
      }),
    ).toBeNull();
  });
});
