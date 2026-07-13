import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { packageComponentPrefixFactFromPackageManifest } from './package-prefix.js';

describe('package component prefix manifest discovery', () => {
  it('discovers the @kovojs/headless-ui prefix from its package metadata', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../headless-ui/package.json', import.meta.url), 'utf8'),
    ) as unknown;

    expect(packageComponentPrefixFactFromPackageManifest(manifest)).toEqual({
      packageName: '@kovojs/headless-ui',
      prefix: 'kovo-',
    });
  });

  it('can attach an app-side effective prefix alias to the discovered fact', () => {
    expect(
      packageComponentPrefixFactFromPackageManifest(
        {
          kovo: { prefix: 'acme-' },
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

  it('emits a missing-prefix fact when a package has kovo metadata without a prefix', () => {
    expect(
      packageComponentPrefixFactFromPackageManifest({ kovo: {}, name: '@bad/prefix' }),
    ).toEqual({
      packageName: '@bad/prefix',
      prefix: null,
    });
  });

  it('ignores inherited manifest and option fields', () => {
    const inheritedManifest = Object.create({
      kovo: { prefix: 'forged-' },
      name: '@forged/package',
    }) as unknown;
    expect(packageComponentPrefixFactFromPackageManifest(inheritedManifest)).toBeNull();

    const inheritedOptions = Object.create({
      effectivePrefix: 'forged-effective-',
      requirePrefix: true,
    }) as { effectivePrefix?: string; requirePrefix?: boolean };
    expect(
      packageComponentPrefixFactFromPackageManifest({ name: '@missing/prefix' }, inheritedOptions),
    ).toBeNull();
  });

  it('does not invoke manifest accessors or a late Array.isArray replacement', () => {
    let getterHits = 0;
    const accessorManifest = Object.defineProperty({}, 'name', {
      enumerable: true,
      get() {
        getterHits += 1;
        return '@forged/accessor';
      },
    });
    expect(packageComponentPrefixFactFromPackageManifest(accessorManifest)).toBeNull();
    expect(getterHits).toBe(0);

    const nativeIsArray = Array.isArray;
    let arrayPoisonHits = 0;
    try {
      Array.isArray = () => {
        arrayPoisonHits += 1;
        return false;
      };
      const arrayManifest = Object.assign([], {
        kovo: { prefix: 'forged-' },
        name: '@forged/array',
      });
      expect(packageComponentPrefixFactFromPackageManifest(arrayManifest)).toBeNull();
      expect(arrayPoisonHits).toBe(0);
    } finally {
      Array.isArray = nativeIsArray;
    }
  });

  it('returns an immutable own-data prefix fact', () => {
    const fact = packageComponentPrefixFactFromPackageManifest({
      kovo: { prefix: 'acme-' },
      name: '@acme/primitives',
    });

    expect(fact).toEqual({ packageName: '@acme/primitives', prefix: 'acme-' });
    expect(Object.isFrozen(fact)).toBe(true);
    expect(Object.hasOwn(fact ?? {}, 'packageName')).toBe(true);
  });
});
