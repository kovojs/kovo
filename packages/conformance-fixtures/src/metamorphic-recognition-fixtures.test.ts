import { describe, expect, it } from 'vitest';

import {
  PHASE0_METAMORPHIC_REQUIRED_CODES,
  metamorphicRecognitionCoverageRows,
  metamorphicRecognitionSeeds,
  metamorphicRecognitionTodoRows,
} from './metamorphic-recognition-fixtures.js';

describe('Phase 0 metamorphic recognition-fuzzing harness', () => {
  it('keeps the seed corpus on the required Phase 0 gates', () => {
    expect(metamorphicRecognitionCoverageRows()).toMatchObject([
      {
        code: 'KV414',
        enforced: 5,
        label: 'owner read IDOR',
        todo: 2,
      },
      {
        code: 'KV435',
        enforced: 5,
        label: 'secret query wire',
        todo: 2,
      },
      {
        code: 'KV422',
        enforced: 7,
        label: 'SQL text provenance',
        todo: 0,
      },
      {
        code: 'KV426',
        enforced: 3,
        label: 'trusted HTML provenance',
        todo: 4,
      },
      {
        code: 'KV407',
        enforced: 5,
        label: 'undeclared query read',
        todo: 2,
      },
      {
        code: 'KV311',
        enforced: 2,
        label: 'update coverage',
        todo: 2,
      },
    ]);

    expect(metamorphicRecognitionCoverageRows().map((row) => row.code)).toEqual([
      ...PHASE0_METAMORPHIC_REQUIRED_CODES,
    ]);
  });

  it('makes known-failing variants explicit instead of hiding xfails', () => {
    const todoRows = metamorphicRecognitionTodoRows();

    expect(todoRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV414',
          kind: 'destructured-binding',
          reason: expect.stringContaining('Workstream B'),
        }),
        expect.objectContaining({
          code: 'KV426',
          kind: 're-export-barrel',
          reason: expect.stringContaining('re-export'),
        }),
        expect.objectContaining({
          code: 'KV311',
          kind: 'wrapper-helper',
          reason: expect.stringContaining('closure-shaped read'),
        }),
      ]),
    );
    expect(todoRows.every((row) => row.reason.length > 0)).toBe(true);
  });

  for (const seed of metamorphicRecognitionSeeds) {
    describe(`${seed.code} ${seed.label}`, () => {
      for (const variant of seed.variants) {
        const testName = `${variant.kind}: ${variant.label}`;

        if (variant.expectation === 'todo') {
          it.todo(`${testName} (${variant.reason})`);
          continue;
        }

        it(testName, () => {
          const result = variant.run?.();

          expect(result, 'enforced variants must provide a runner').toBeDefined();
          expect(result?.codes, result?.detail.join('\n')).toContain(seed.code);
        });
      }
    });
  }
});
