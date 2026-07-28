import { describe, it } from 'vitest';

import { runD1V5Measurement } from './measure-v5.ts';

describe('D1 v5 actual-contract measurement command', () => {
  it('regenerates or verifies both arms through the authenticated packed compiler', async () => {
    await runD1V5Measurement(process.env.KOVO_D1_MEASURE_MODE === 'verify' ? 'verify' : 'write');
  }, 600_000);
});
