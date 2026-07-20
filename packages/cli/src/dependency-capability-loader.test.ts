// @kovo-security-classifier-corpus dependency-capability-loader
import { describe, expect, it } from 'vitest';

import {
  assertDependencyCapabilityImport,
  type AppDependencyCapabilityManifest,
} from './dependency-capability-loader.js';

const manifest: AppDependencyCapabilityManifest = {
  dependencies: [
    {
      entries: [
        {
          conditions: ['default', 'import'],
          imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
          specifier: 'safe-parser',
        },
      ],
      manifestFingerprint: 'sha256:safe-parser-v1',
      packageName: 'safe-parser',
      packageVersion: '1.2.3',
      summaryVersion: 'safe-parser-review/1',
      verdict: 'open',
    },
  ],
  schema: 'kovo-app-dependency-capabilities/v1',
};

describe('SPEC §6.6 app dependency loader attenuation', () => {
  // @kovo-security-certifies C13 dependency-capability-loader-identity
  it('admits only the exact censused dependency import and installed identity', () => {
    expect(
      assertDependencyCapabilityImport(manifest, 'safe-parser', {
        conditions: ['default', 'import'],
        exportStatus: 'resolved',
        manifestFingerprint: 'sha256:safe-parser-v1',
        packageName: 'safe-parser',
        packageVersion: '1.2.3',
        specifier: 'safe-parser',
      }),
    ).toMatchObject({ packageName: 'safe-parser', summaryVersion: 'safe-parser-review/1' });

    for (const source of ['safe-parser/hidden', 'surprise-loader']) {
      expect(() =>
        assertDependencyCapabilityImport(manifest, source, {
          conditions: ['default', 'import'],
          exportStatus: 'resolved',
          manifestFingerprint: 'sha256:safe-parser-v1',
          packageName: 'safe-parser',
          packageVersion: '1.2.3',
          specifier: source,
        }),
      ).toThrow(/KV448.*absent from the compiler-derived dependency manifest/u);
    }

    for (const installed of [
      { packageVersion: '1.2.4' },
      { manifestFingerprint: 'sha256:substituted' },
      { conditions: ['default', 'require'] },
    ]) {
      expect(() =>
        assertDependencyCapabilityImport(manifest, 'safe-parser', {
          conditions: ['default', 'import'],
          exportStatus: 'resolved',
          manifestFingerprint: 'sha256:safe-parser-v1',
          packageName: 'safe-parser',
          packageVersion: '1.2.3',
          specifier: 'safe-parser',
          ...installed,
        }),
      ).toThrow(/KV448.*identity drifted after capability census/u);
    }
  });

  // @kovo-security-certifies C13 dependency-capability-loader-closed-verdict
  it('never turns a raw or closed manifest row into loader authority', () => {
    for (const disposition of ['raw', 'framework-door'] as const) {
      const closed: AppDependencyCapabilityManifest = {
        ...manifest,
        dependencies: [
          {
            ...manifest.dependencies[0]!,
            entries: [
              {
                ...manifest.dependencies[0]!.entries[0]!,
                imports: [{ capabilities: ['network'], disposition, name: 'parse' }],
              },
            ],
            verdict: 'closed',
          },
        ],
      };
      expect(() =>
        assertDependencyCapabilityImport(closed, 'safe-parser', {
          conditions: ['default', 'import'],
          exportStatus: 'resolved',
          manifestFingerprint: 'sha256:safe-parser-v1',
          packageName: 'safe-parser',
          packageVersion: '1.2.3',
          specifier: 'safe-parser',
        }),
      ).toThrow(/KV448.*does not carry an open least-authority verdict/u);
    }
  });
});
