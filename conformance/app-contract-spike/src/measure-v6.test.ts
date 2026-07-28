import { describe, it } from 'vitest';

import { runD1V6Measurement } from './measure-v6.ts';

describe('D1 v6 actual-contract measurement command', () => {
  it('regenerates or verifies both arms through the authenticated packed compiler', async () => {
    await runD1V6Measurement(process.env.KOVO_D1_V6_MEASURE_MODE === 'verify' ? 'verify' : 'write');
  }, 600_000);
});
