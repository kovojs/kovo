import { describe, expect, it } from 'vitest';

import {
  complementDfa,
  decideContainment,
  decideDisjointness,
  determinizeAst,
  dfaAccepts,
  FiniteAutomataStateBudgetError,
  intersectDfa,
  productDfa,
  shortestAcceptedString,
} from './automata.js';
import { parseLinearRegexAst } from './index.js';

function language(source: string, flags = '') {
  const parsed = parseLinearRegexAst(source, flags);
  return determinizeAst(parsed.ast, parsed.flags);
}

function strings(alphabet: readonly string[], maxLength: number): string[] {
  const values = [''];
  let frontier = [''];
  for (let length = 1; length <= maxLength; length += 1) {
    const next: string[] = [];
    for (const prefix of frontier) {
      for (const character of alphabet) next.push(prefix + character);
    }
    values.push(...next);
    frontier = next;
  }
  return values;
}

describe('finite automata substrate', () => {
  it('determinizes the production regex AST with exact whole-string semantics', () => {
    const source = '(?:ab|a)*c?';
    const dfa = language(source);
    const oracle = new RegExp(`^(?:${source})$`, 'u');

    for (const value of strings(['a', 'b', 'c', 'x'], 5)) {
      expect(dfaAccepts(dfa, value), JSON.stringify(value)).toBe(oracle.test(value));
    }
  });

  it('supports character-class complement and ASCII case folding symbolically', () => {
    const negated = language('[^a-c]+');
    expect(dfaAccepts(negated, 'XYZ')).toBe(true);
    expect(dfaAccepts(negated, 'XbZ')).toBe(false);

    const folded = language('[b-d]+', 'i');
    for (const value of ['b', 'C', 'dD', 'Bc']) expect(dfaAccepts(folded, value)).toBe(true);
    for (const value of ['a', 'E', 'bAe']) expect(dfaAccepts(folded, value)).toBe(false);
  });

  it('builds complement and product languages', () => {
    const left = language('a(?:b|c)');
    const right = language('(?:ac|z)');
    const intersection = intersectDfa(left, right);
    expect(shortestAcceptedString(intersection)).toBe('ac');
    expect(dfaAccepts(intersection, 'ab')).toBe(false);

    const notLeft = complementDfa(left);
    for (const value of strings(['a', 'b', 'c'], 3)) {
      expect(dfaAccepts(notLeft, value)).toBe(!dfaAccepts(left, value));
    }
  });

  it('decides containment and returns a globally shortest counterexample', () => {
    expect(decideContainment(language('[ab]*'), language('(?:a|b)*'))).toMatchObject({
      holds: true,
    });

    const decision = decideContainment(language('(?:zz|a)'), language('z*'));
    expect(decision).toEqual({
      counterexample: 'a',
      exploredStates: expect.any(Number),
      holds: false,
    });
    if (!decision.holds) {
      // BFS is a minimizer, not merely a witness finder: no shorter word is outside the superset.
      expect(decision.counterexample).toHaveLength(1);
      expect(dfaAccepts(language('z*'), '')).toBe(true);
    }
  });

  it('finds the empty-string disjointness counterexample without search', () => {
    const decision = decideDisjointness(language('a*'), language('b*'));
    expect(decision).toMatchObject({ counterexample: '', holds: false });
  });

  it('throws on the planted product state-budget mutant', () => {
    const left = language('[ab]*a');
    const right = language('[ab]*b');
    expect(() => productDfa(left, right, () => true, { stateBudget: 1 })).toThrow(
      FiniteAutomataStateBudgetError,
    );
    expect(() => productDfa(left, right, () => true, { stateBudget: 1 })).toThrow(
      /product construction exceeded the hard 1-state budget/u,
    );
  });
});
