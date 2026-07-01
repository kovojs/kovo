import { describe, expect, it } from 'vitest';

import {
  DEC10_CORPUS_DIALECTS,
  dec10AdversarialSeeds,
  dec10GreenCompilerCases,
  dec10GreenCorpusRows,
  dec10GreenSqlCases,
} from './adversarial-corpus.js';

describe('DEC10 adversarial corpus fixtures', () => {
  it('keeps SQL, taint, and import/alias adversarial seed families explicit', () => {
    expect(dec10AdversarialSeeds.map((seed) => seed.family).sort()).toEqual([
      'import-alias',
      'sql',
      'taint-expression',
    ]);
    expect(dec10AdversarialSeeds.every((seed) => seed.payloads.length >= 4)).toBe(true);
  });

  it('expands every green compiler and SQL case across both DEC10 dialects', () => {
    const rows = dec10GreenCorpusRows();
    expect(new Set(rows.map((row) => row.dialect))).toEqual(new Set(DEC10_CORPUS_DIALECTS));
    expect(rows).toHaveLength(
      DEC10_CORPUS_DIALECTS.length * (dec10GreenCompilerCases.length + dec10GreenSqlCases.length),
    );
    for (const dialect of DEC10_CORPUS_DIALECTS) {
      expect(
        rows
          .filter((row) => row.dialect === dialect)
          .map((row) => row.id)
          .sort(),
      ).toEqual(
        [
          ...dec10GreenCompilerCases.map((row) => row.id),
          ...dec10GreenSqlCases.map((row) => row.id),
        ].sort(),
      );
    }
  });
});
