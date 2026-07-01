import { describe, expect, it } from 'vitest';

import {
  METAMORPHIC_RECOGNITION_BLOCKERS,
  PHASE0_METAMORPHIC_REQUIRED_CODES,
  metamorphicRecognitionCoverageRows,
  metamorphicRecognitionGateViolations,
  metamorphicRecognitionSeeds,
  metamorphicRecognitionTodoRows,
} from './metamorphic-recognition-fixtures.js';

describe('Phase 0 metamorphic recognition-fuzzing harness', () => {
  it('keeps the CI-gated seed corpus explicit for every required Phase 0 gate', () => {
    expect(metamorphicRecognitionCoverageRows()).toEqual([
      {
        code: 'KV414',
        enforced: 7,
        label: 'owner read IDOR',
        todo: 0,
        variants: [
          'control',
          'import-alias',
          'namespace-import',
          're-export-barrel',
          'local-alias',
          'destructured-binding',
          'wrapper-helper',
        ],
      },
      {
        code: 'KV435',
        enforced: 7,
        label: 'secret query wire',
        todo: 0,
        variants: [
          'control',
          'import-alias',
          'namespace-import',
          're-export-barrel',
          'local-alias',
          'destructured-binding',
          'wrapper-helper',
        ],
      },
      {
        code: 'KV422',
        enforced: 7,
        label: 'SQL text provenance',
        todo: 0,
        variants: [
          'control',
          'import-alias',
          'namespace-import',
          're-export-barrel',
          'local-alias',
          'destructured-binding',
          'wrapper-helper',
        ],
      },
      {
        code: 'KV426',
        enforced: 7,
        label: 'trusted HTML provenance',
        todo: 0,
        variants: [
          'control',
          'import-alias',
          'destructured-binding',
          'namespace-import',
          're-export-barrel',
          'local-alias',
          'wrapper-helper',
        ],
      },
      {
        code: 'KV407',
        enforced: 7,
        label: 'undeclared query read',
        todo: 0,
        variants: [
          'control',
          'import-alias',
          'namespace-import',
          're-export-barrel',
          'local-alias',
          'destructured-binding',
          'wrapper-helper',
        ],
      },
      {
        code: 'KV311',
        enforced: 5,
        label: 'update coverage',
        todo: 0,
        variants: [
          'control',
          'local-alias',
          'destructured-binding',
          'wrapper-helper',
          'function-helper',
        ],
      },
    ]);

    expect(metamorphicRecognitionCoverageRows().map((row) => row.code)).toEqual([
      ...PHASE0_METAMORPHIC_REQUIRED_CODES,
    ]);
  });

  it('fails the CI gate when a required seed or TODO blocker is missing', () => {
    expect(metamorphicRecognitionGateViolations()).toEqual([]);
    expect(
      metamorphicRecognitionGateViolations([
        {
          code: 'KV414',
          description: 'missing runner fixture',
          label: 'broken',
          variants: [{ expectation: 'todo', kind: 'control', label: 'unblocked TODO' }],
        },
      ]),
    ).toEqual(
      expect.arrayContaining([
        'KV414/control: TODO variants require a precise reason',
        'KV414/control: TODO variants require named blockers',
        'KV435: missing CI-gated metamorphic seed',
      ]),
    );
  });

  it('keeps phase-0 TODOs empty unless a test explicitly approves them', () => {
    const todoRows = metamorphicRecognitionTodoRows();
    const approvedTodoSeed = {
      code: 'KV414' as const,
      description: 'approved TODO fixture',
      label: 'approved TODO',
      variants: [
        {
          expectation: 'enforced' as const,
          kind: 'control' as const,
          label: 'control',
          run: () => ({ codes: ['KV414'], detail: [] }),
        },
        {
          blockers: [METAMORPHIC_RECOGNITION_BLOCKERS.semanticIdentity],
          expectation: 'todo' as const,
          kind: 'import-alias' as const,
          label: 'approved TODO',
          reason: 'temporary explicitly approved TODO in this guard fixture',
        },
      ],
    };
    const seedsWithTodo = [
      approvedTodoSeed,
      ...metamorphicRecognitionSeeds.filter((seed) => seed.code !== 'KV414'),
    ];

    expect(todoRows).toEqual([]);
    expect(todoRows.every((row) => row.reason.length > 0 && row.blockers.length > 0)).toBe(true);
    expect(metamorphicRecognitionGateViolations(seedsWithTodo)).toContain(
      'KV414/import-alias: TODO variant lacks explicit approval',
    );
    expect(
      metamorphicRecognitionGateViolations(seedsWithTodo, {
        approvedTodos: ['KV414/import-alias'],
      }),
    ).not.toContain('KV414/import-alias: TODO variant lacks explicit approval');
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
