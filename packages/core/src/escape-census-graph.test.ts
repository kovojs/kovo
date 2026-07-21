import { describe, expect, it } from 'vitest';

import { ESCAPE_CENSUS_DOORS, validateKovoExplainInput } from './graph.js';

const coverage = {
  doors: ESCAPE_CENSUS_DOORS,
  schema: 'kovo.escape-census-coverage/v2' as const,
  sources: {
    allowControlChars: 'trustEscapes',
    'csrf:false': 'trustEscapes',
    'ctx.fetch': 'securitySemanticGraph',
    kovoAnalyzerSummary: 'trustEscapes',
    trustedHtml: 'trustEscapes',
    trustedSql: 'trustEscapes',
  },
};

describe('escape census graph producer witness', () => {
  it('accepts the exact closed metric-E vocabulary and authoritative producers', () => {
    expect(validateKovoExplainInput({ escapeCensus: coverage })).toEqual([]);
  });

  it('rejects missing, reordered, and reassigned coverage facts', () => {
    const forged = {
      ...coverage,
      doors: [...ESCAPE_CENSUS_DOORS].reverse(),
      sources: {
        ...coverage.sources,
        'ctx.fetch': 'trustEscapes',
      },
    };

    expect(validateKovoExplainInput({ escapeCensus: forged })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'escapeCensus.doors[0]' }),
        expect.objectContaining({ path: 'escapeCensus.sources.ctx.fetch' }),
      ]),
    );
  });
});
