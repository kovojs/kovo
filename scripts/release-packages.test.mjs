import { describe, expect, it } from 'vitest';

import { releasePackages } from './release-packages.mjs';

describe('release package ordering', () => {
  it('orders required workspace dependencies without turning optional peers into cycles', () => {
    const names = releasePackages().map((pkg) => pkg.name);

    expect(names.indexOf('@kovojs/server')).toBeLessThan(names.indexOf('@kovojs/better-auth'));
  });
});
