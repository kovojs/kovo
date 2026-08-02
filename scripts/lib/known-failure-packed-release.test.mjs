import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  knownFailurePackedEnvironment,
  knownFailurePackedRuntimeEnvironment,
} from './known-failure-packed-release.mjs';

const release = { nodeModules: path.join(path.sep, 'private', 'packed-release', 'node_modules') };

describe('known-failure packed environments', () => {
  it('supports explicit harness policy but strips repository Node flags from packed runtime', () => {
    const harness = knownFailurePackedEnvironment(release, {
      NODE_OPTIONS: '--require=/private/egress-floor.cjs',
    });
    const runtime = knownFailurePackedRuntimeEnvironment(release, {
      BETTER_AUTH_URL: null,
      NODE_OPTIONS: '--require=/must-not-win.cjs',
    });

    expect(harness.NODE_OPTIONS).toBe('--require=/private/egress-floor.cjs');
    expect(harness.PATH?.split(path.delimiter)[0]).toBe(path.join(release.nodeModules, '.bin'));
    expect(runtime).not.toHaveProperty('NODE_OPTIONS');
    expect(runtime).not.toHaveProperty('BETTER_AUTH_URL');
  });
});
