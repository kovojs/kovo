import { describe, expect, it } from 'vitest';

import { evaluateGreenCorpus } from './check-green-corpus.mjs';

describe('check-green-corpus gate', () => {
  it('passes when the DEC10 green corpus runner passes', () => {
    expect(evaluateGreenCorpus({ run: () => ({ ok: true, output: '' }) })).toMatchObject({
      findings: [],
      ok: true,
      rows: 18,
    });
  });

  it('fails when the green corpus runner reports a KV diagnostic', () => {
    expect(
      evaluateGreenCorpus({
        run: () => ({ ok: false, output: 'pglite/bad: unexpected KV426' }),
      }),
    ).toEqual({
      findings: ['pglite/bad: unexpected KV426'],
      ok: false,
      rows: 18,
    });
  });
});
