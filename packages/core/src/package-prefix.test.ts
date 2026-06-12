import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { packageComponentPrefixFactFromPackageManifest } from './package-prefix.js';

describe('package component prefix manifest discovery', () => {
  it('discovers the @jiso/headless-ui prefix from its package metadata', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../headless-ui/package.json', import.meta.url), 'utf8'),
    ) as unknown;

    expect(packageComponentPrefixFactFromPackageManifest(manifest)).toEqual({
      packageName: '@jiso/headless-ui',
      prefix: 'jiso-',
    });
  });

  it('can attach an app-side effective prefix alias to the discovered fact', () => {
    expect(
      packageComponentPrefixFactFromPackageManifest(
        {
          jiso: { prefix: 'acme-' },
          name: '@acme/primitives',
        },
        { effectivePrefix: 'acme-primitives-' },
      ),
    ).toEqual({
      effectivePrefix: 'acme-primitives-',
      packageName: '@acme/primitives',
      prefix: 'acme-',
    });
  });

  it('can emit a missing-prefix fact for an imported component package', () => {
    expect(
      packageComponentPrefixFactFromPackageManifest(
        { name: '@missing/prefix' },
        { requirePrefix: true },
      ),
    ).toEqual({
      packageName: '@missing/prefix',
      prefix: null,
    });
  });

  it('emits a missing-prefix fact when a package has jiso metadata without a prefix', () => {
    expect(
      packageComponentPrefixFactFromPackageManifest({ jiso: {}, name: '@bad/prefix' }),
    ).toEqual({
      packageName: '@bad/prefix',
      prefix: null,
    });
  });
});
