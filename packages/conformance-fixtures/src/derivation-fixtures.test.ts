import type { JsonValue } from '@kovojs/core';
import { applyPatchProgram } from '@kovojs/core/internal/derivation';
import { deriveOptimistic } from '@kovojs/drizzle/internal/derive';
import { lowerTransform } from '@kovojs/drizzle/internal/derive-codegen';
import { describe, expect, it } from 'vitest';

import {
  applyContractFixture,
  coverageDerivationFact,
  derivationContractFixtures,
  derivationStatusLabel,
  type DerivationContractFixture,
} from './derivation-fixtures.js';

// SPEC.md §10.5: the shared contract fixtures are the single source the deriver
// (Phase 2), codegen (Phase 3), and commuting-diagram suite (Phase 6) consume.
// Here we prove each fixture's program is internally consistent — running it over
// `before` yields `after` modulo content-matched placeholder columns.

function omitPlaceholders(value: JsonValue, fixture: DerivationContractFixture): JsonValue {
  if (fixture.placeholderColumns.length === 0) return value;
  // Placeholder columns of pushed rows are content-matched on reconcile, so they
  // are excluded from the commuting-diagram equality (SPEC.md §10.5).
  const clone = structuredClone(value) as { items?: JsonValue[] };
  if (Array.isArray(clone.items)) {
    clone.items = clone.items.map((row) => {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) return row;
      const next = { ...(row as Record<string, JsonValue>) };
      for (const column of fixture.placeholderColumns) delete next[column];
      return next;
    });
  }
  return clone as JsonValue;
}

describe('derivation contract fixtures', () => {
  it('covers the commerce cart/add pairs plus the §10.5 grammar rules they exercise', () => {
    expect(derivationContractFixtures.map((fixture) => fixture.name)).toEqual([
      'cart/add × cart (INSERT × SUM)',
      'cart/add × productGrid (UPDATE × Scalar on keyed row, guarded)',
      'cart/add × orderHistory (INSERT × AGG push, placeholders)',
      'removeTodo × todoCount (DELETE × COUNT, guarded)',
    ]);
  });

  for (const fixture of derivationContractFixtures) {
    it(`program commutes for ${fixture.name}`, () => {
      const observed = omitPlaceholders(applyContractFixture(fixture), fixture);
      const expected = omitPlaceholders(fixture.after, fixture);
      expect(observed).toEqual(expected);
    });

    it(`every program op targets the declared query for ${fixture.name}`, () => {
      expect(fixture.program.query).toBe(fixture.query);
      expect(fixture.shape.query).toBe(fixture.query);
    });

    it(`deriveOptimistic reproduces the contract program for ${fixture.name}`, () => {
      // SPEC.md §10.5: the deriver and the shared contract are one source — the
      // deriver must produce exactly the fixture's program from its effect+shape.
      expect(deriveOptimistic([fixture.effect], fixture.shape)).toEqual({
        kind: 'derived',
        program: fixture.program,
      });
    });

    it(`codegen ≡ interpreter for ${fixture.name}`, () => {
      // SPEC.md §10.4: the committed transform source must behave identically to the
      // reference interpreter — executing it is exactly what proves codegen ≡ interpreter.
      // eslint-disable-next-line no-implied-eval, @typescript-eslint/no-implied-eval -- see above
      const factory = new Function(
        'tempId',
        'now',
        `return ${lowerTransform(fixture.program)};`,
      ) as (
        t: () => JsonValue,
        n: () => JsonValue,
      ) => (current: JsonValue, input: JsonValue) => void;
      const transform = factory(
        () => '__tempId__',
        () => 0,
      );
      const generated = structuredClone(fixture.before);
      expect(transform(generated, fixture.input)).toBeUndefined();
      const interpreted = applyPatchProgram(fixture.before, fixture.input, fixture.program, {
        now: () => 0,
        tempId: () => '__tempId__',
      });
      expect(generated).toEqual(interpreted);
      expect(generated).toEqual(fixture.after);
    });
  }
});

describe('coverage derivation helpers', () => {
  it('extracts derivation metadata as a formatting-resistant fact', () => {
    expect(coverageDerivationFact({ mutation: 'cart/add', query: 'cart', status: 'derived' })).toBe(
      undefined,
    );
    expect(
      coverageDerivationFact({
        derivation: { status: 'derived' },
        mutation: 'cart/add',
        query: 'cart',
        status: 'derived',
      }),
    ).toEqual({ status: 'derived' });
  });

  it('labels derivation statuses for the explain surface', () => {
    expect(derivationStatusLabel({ status: 'derived' })).toBe('derived');
    expect(
      derivationStatusLabel({
        reason: { code: 'opaque-orderby', column: 'rank' },
        status: 'PUNTED',
      }),
    ).toBe('PUNTED (Opaque orderBy: rank)');
  });
});
