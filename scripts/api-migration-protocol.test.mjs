import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  API_MIGRATION_LEDGER_SCHEMA,
  API_MIGRATION_REFUSAL_CATEGORIES,
  API_MIGRATION_RESULT_SCHEMA,
  validateApiMigrationLedger,
  validateApiMigrationResult,
} from './api-migration-protocol.mjs';
import { repoRoot } from './public-packages.mjs';

const decisions = JSON.parse(
  readFileSync(path.join(repoRoot, 'api-surface-decisions.json'), 'utf8'),
);
const committedLedger = JSON.parse(
  readFileSync(path.join(repoRoot, 'api-migrations.json'), 'utf8'),
);
const fixturePath = 'scripts/api-migration-protocol.test.mjs';

function readyLedger(decision) {
  const from = {
    specifier: decision.specifier,
    ...(decision.symbol ? { symbol: decision.symbol } : {}),
  };
  const to = {
    specifier: decision.decision === 'move' ? decision.canonicalHome : '@kovojs/core/diagnostics',
    ...(decision.symbol ? { symbol: decision.symbol } : {}),
  };
  return {
    schema: API_MIGRATION_LEDGER_SCHEMA,
    resultSchema: API_MIGRATION_RESULT_SCHEMA,
    modes: ['check', 'write'],
    refusalCategories: [...API_MIGRATION_REFUSAL_CATEGORIES],
    batches: [
      {
        id: 'sample-move',
        state: 'ready',
        owner: 'api-stewards',
        decisions: [decision.id ?? decision.specifier],
        tool: {
          path: fixturePath,
          resultSchema: API_MIGRATION_RESULT_SCHEMA,
          checkArgs: ['--check'],
          writeArgs: ['--write'],
        },
        releaseNote: fixturePath,
        rollback:
          'Restore the clean worktree snapshot and rerun the check mode before another write.',
        rules: [
          {
            id: 'rewrite-import',
            action: 'rewrite',
            from,
            to,
          },
          {
            id: 'refuse-dynamic-import',
            action: 'refuse',
            from,
            category: 'dynamic-import',
            reason:
              'A computed module or property name cannot be rewritten without guessing the binding.',
          },
        ],
        fixtures: {
          rewrites: [fixturePath],
          refusals: [fixturePath],
        },
        exercised: {
          resultSchema: API_MIGRATION_RESULT_SCHEMA,
          command: `node ${fixturePath} --check`,
        },
      },
    ],
  };
}

describe('API migration protocol', () => {
  it('accepts the checked empty opening ledger before the first breaking batch', () => {
    expect(
      validateApiMigrationLedger({ ledger: committedLedger, decisions, repoRoot }).findings,
    ).toEqual([]);
  });

  it('accepts a ready batch only after rewrite, refusal, and exercised evidence exists', () => {
    const decision = decisions.symbols.find((row) => row.decision === 'move');
    const result = validateApiMigrationLedger({
      ledger: readyLedger(decision),
      decisions,
      repoRoot,
    });
    expect(result.findings).toEqual([]);
  });

  it('fails closed when a ready batch lacks refusal fixtures', () => {
    const decision = decisions.symbols.find((row) => row.decision === 'move');
    const ledger = readyLedger(decision);
    ledger.batches[0].fixtures.refusals = [];
    const result = validateApiMigrationLedger({ ledger, decisions, repoRoot });
    expect(result.findings).toContain(
      'batches[0].fixtures.refusals must be non-empty before removal',
    );
  });

  it('does not allow the old export to disappear before its batch reaches removed', () => {
    const mutatedDecisions = structuredClone(decisions);
    const decision = mutatedDecisions.symbols.find((row) => row.decision !== 'keep');
    decision.state = 'removed';
    decision.migrationBatch = 'sample-move';
    const ledger = readyLedger(decision);
    const result = validateApiMigrationLedger({
      ledger,
      decisions: mutatedDecisions,
      repoRoot,
    });
    expect(result.findings).toContain(
      `${decision.id}: old export cannot disappear before sample-move reaches removed`,
    );
  });

  it('validates structured rewrite and source-anchored refusal reports', () => {
    const result = {
      schema: API_MIGRATION_RESULT_SCHEMA,
      batch: 'sample-move',
      mode: 'check',
      files: [
        { path: 'src/rewritten.ts', state: 'rewritten' },
        {
          path: 'src/refused.ts',
          state: 'refused',
          refusals: [
            {
              category: 'trust-decision',
              anchor: { start: 12, end: 28 },
            },
          ],
        },
      ],
      summary: { rewritten: 1, unchanged: 0, refused: 1 },
    };
    expect(
      validateApiMigrationResult(result, { batch: 'sample-move', mode: 'check' }).findings,
    ).toEqual([]);
  });

  it('rejects unanchored refusals and dishonest summary counts', () => {
    const result = {
      schema: API_MIGRATION_RESULT_SCHEMA,
      batch: 'sample-move',
      mode: 'check',
      files: [
        {
          path: 'src/refused.ts',
          state: 'refused',
          refusals: [{ category: 'trust-decision' }],
        },
      ],
      summary: { rewritten: 1, unchanged: 0, refused: 1 },
    };
    const findings = validateApiMigrationResult(result, {
      batch: 'sample-move',
      mode: 'check',
    }).findings;
    expect(findings).toContain('files[0]: refusal needs a source byte-range anchor');
    expect(findings).toContain('result summary counts must equal files.length');
  });
});
