import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  authenticatedPackedJourneyPackages,
  packedTarballPath,
  parseGoldenJourneyArgs,
  validateExternalPackedJourneyManifest,
} from './golden-journey.mjs';
import { DEVEX_GOLDEN_RELEASE_SCENARIO } from './devex-golden-contract.mjs';
import { offlineAgentScenario } from './golden-journey/offline-agent.mjs';
import {
  packageSetIdentity as packedAppPackageSetIdentity,
  packedAppsScenario,
} from './golden-journey/packed-app.mjs';
import {
  authenticatedPackedJourneyPackages as directAuthenticatedPackedJourneyPackages,
  authenticatedPackedJourneyPackagesFromManifestBytes,
  packageSetIdentity,
  packedTarballPath as directPackedTarballPath,
  validateExternalPackedJourneyManifest as directValidateExternalPackedJourneyManifest,
} from './golden-journey/packed-package-auth.mjs';
import { loadAuthenticatedPackedConsumerInputs } from './lib/authenticated-packed-consumer.mjs';
import { manifestPath, repoRoot } from './release-packages.mjs';

describe('golden journey command', () => {
  it('preserves the established helper exports while narrowing evaluator imports', () => {
    expect(authenticatedPackedJourneyPackages).toBe(directAuthenticatedPackedJourneyPackages);
    expect(packedTarballPath).toBe(directPackedTarballPath);
    expect(validateExternalPackedJourneyManifest).toBe(directValidateExternalPackedJourneyManifest);
    expect(packedAppPackageSetIdentity).toBe(packageSetIdentity);
  });

  it('preserves bytewise package identity ordering in the narrow authentication module', () => {
    const packages = new Map([
      ['unicode', { name: 'ä-package', sha512: 'sha512-unicode', version: '3.0.0' }],
      ['last-ascii', { name: 'z-package', sha512: 'sha512-z', version: '2.0.0' }],
      ['first-ascii', { name: 'a-package', sha512: 'sha512-a', version: '1.0.0' }],
    ]);

    expect(packageSetIdentity(packages)).toEqual([
      { name: 'a-package', sha512: 'sha512-a', version: '1.0.0' },
      { name: 'z-package', sha512: 'sha512-z', version: '2.0.0' },
      { name: 'ä-package', sha512: 'sha512-unicode', version: '3.0.0' },
    ]);
  });

  it('cannot label B packages with digest(A) during a deterministic A→B→A replacement', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-packed-manifest-aba-'));
    try {
      const records = new Map(
        ['A', 'B'].map((identity) => {
          const tarballBytes = Buffer.from(`tarball-${identity}`);
          const tarballPath = path.join(root, `${identity.toLowerCase()}.tgz`);
          writeFileSync(tarballPath, tarballBytes);
          return [identity, authenticatedRecord(identity, tarballPath, tarballBytes)];
        }),
      );
      const manifestA = Buffer.from('{"identity":"A"}\n');
      const manifestB = Buffer.from('{"identity":"B"}\n');
      const transitions = [];
      let visibleManifest = manifestA;
      let readCount = 0;

      const result = loadAuthenticatedPackedConsumerInputs(path.join(root, 'manifest.json'), {
        authenticateManifestBytes(_manifestPath, authoritativeBytes) {
          transitions.push(`authenticate-visible:${manifestIdentity(visibleManifest)}`);
          // Missing byte authority deliberately falls back to the path-visible B, reproducing the
          // former path-reread wiring and making this regression fail with digest(A)+packages(B).
          const selectedBytes = Buffer.isBuffer(authoritativeBytes)
            ? authoritativeBytes
            : visibleManifest;
          const selectedIdentity = manifestIdentity(selectedBytes);
          transitions.push(`authenticate-selected:${selectedIdentity}`);
          visibleManifest = manifestA;
          transitions.push('restore:A');
          return new Map([['@kovojs/core', records.get(selectedIdentity)]]);
        },
        readManifestBytes() {
          readCount += 1;
          const captured = Buffer.from(visibleManifest);
          transitions.push(`read-${String(readCount)}:${manifestIdentity(captured)}`);
          if (readCount === 1) {
            visibleManifest = manifestB;
            transitions.push('swap:B');
          }
          return captured;
        },
      });

      expect(transitions).toEqual([
        'read-1:A',
        'swap:B',
        'authenticate-visible:B',
        'authenticate-selected:A',
        'restore:A',
        'read-2:A',
      ]);
      expect(result.manifestSha256).toBe(sha256(manifestA));
      expect(result.packages.get('@kovojs/core')).toMatchObject({
        sha512: records.get('A').sha512,
        tarballBytes: Buffer.from('tarball-A'),
        tarballPath: records.get('A').tarballPath,
      });
      expect(result.packages.get('@kovojs/core').entries[0].data).toEqual(Buffer.from('A'));
      expect(result.packages.get('@kovojs/core').sha512).not.toBe(records.get('B').sha512);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('keeps the final manifest reread diagnostic and accepts only bounded Buffer authority', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-packed-manifest-drift-'));
    try {
      const tarballBytes = Buffer.from('tarball-A');
      const tarballPath = path.join(root, 'a.tgz');
      writeFileSync(tarballPath, tarballBytes);
      const record = authenticatedRecord('A', tarballPath, tarballBytes);
      const manifestA = Buffer.from('{"identity":"A"}\n');
      const manifestB = Buffer.from('{"identity":"B"}\n');
      let readCount = 0;

      expect(() =>
        loadAuthenticatedPackedConsumerInputs(path.join(root, 'manifest.json'), {
          authenticateManifestBytes: () => new Map([['@kovojs/core', record]]),
          readManifestBytes: () => (readCount++ === 0 ? manifestA : manifestB),
        }),
      ).toThrow('authenticated packed consumer manifest changed while snapshotting tarballs');
      expect(() =>
        authenticatedPackedJourneyPackagesFromManifestBytes('/tmp/manifest.json', '{}'),
      ).toThrow('packed journey manifest bytes must be a Buffer');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('selects the packed offline-agent scenario and repo-owned manifest by default', () => {
    expect(parseGoldenJourneyArgs(['--scenario', offlineAgentScenario])).toEqual({
      packedManifest: manifestPath,
      scenario: offlineAgentScenario,
    });
  });

  it('resolves explicit manifest/report paths and rejects unknown or missing scenarios', () => {
    expect(
      parseGoldenJourneyArgs([
        '--scenario',
        offlineAgentScenario,
        '--packed-manifest',
        '.release/packed-packages.json',
        '--report',
        '.artifacts/offline-agent.json',
      ]),
    ).toEqual({
      packedManifest: path.join(repoRoot, '.release/packed-packages.json'),
      report: path.join(repoRoot, '.artifacts/offline-agent.json'),
      scenario: offlineAgentScenario,
    });
    expect(() => parseGoldenJourneyArgs([])).toThrow(/--scenario/);
    expect(() => parseGoldenJourneyArgs(['--scenario', 'live-agent'])).toThrow(/offline-agent/);
    expect(() =>
      parseGoldenJourneyArgs(['--scenario', offlineAgentScenario, '--fetch-docs']),
    ).toThrow(/Unknown/);
    expect(() =>
      parseGoldenJourneyArgs(['--scenario', offlineAgentScenario, '--keep-temp']),
    ).toThrow(/Unknown/);
    expect(() =>
      parseGoldenJourneyArgs(['--scenario', offlineAgentScenario, '--dialect', 'sqlite']),
    ).toThrow(/apply only to packed-apps/u);
  });

  it('selects one or both packed starter dialects with bounded statistical samples', () => {
    expect(
      parseGoldenJourneyArgs([
        '--scenario',
        packedAppsScenario,
        '--dialect',
        'sqlite',
        '--samples',
        '5',
        '--artifacts',
        '.release/devex/journey-artifacts',
        '--report',
        '.release/devex/journey.json',
      ]),
    ).toEqual({
      artifactRoot: path.join(repoRoot, '.release/devex/journey-artifacts'),
      dialects: ['sqlite'],
      packedManifest: manifestPath,
      report: path.join(repoRoot, '.release/devex/journey.json'),
      samples: 5,
      scenario: packedAppsScenario,
    });
    expect(parseGoldenJourneyArgs(['--scenario', packedAppsScenario])).toMatchObject({
      dialects: ['postgres', 'sqlite'],
      samples: 1,
    });
    expect(() =>
      parseGoldenJourneyArgs(['--scenario', packedAppsScenario, '--samples', '0']),
    ).toThrow(/integer from 1 through 20/u);
  });

  it('binds the release scorecard to N-sample evaluation and explicit ratification posture', () => {
    expect(
      parseGoldenJourneyArgs([
        '--scenario',
        DEVEX_GOLDEN_RELEASE_SCENARIO,
        '--samples',
        '5',
        '--evaluate',
        '--require-ratified',
      ]),
    ).toMatchObject({
      budgets: path.join(repoRoot, 'devex-budgets.json'),
      dialects: ['postgres', 'sqlite'],
      evaluate: true,
      requireRatified: true,
      samples: 5,
      scenario: DEVEX_GOLDEN_RELEASE_SCENARIO,
    });
    expect(() =>
      parseGoldenJourneyArgs(['--scenario', DEVEX_GOLDEN_RELEASE_SCENARIO, '--require-ratified']),
    ).toThrow(/requires --evaluate/u);
    expect(() => parseGoldenJourneyArgs(['--scenario', packedAppsScenario, '--evaluate'])).toThrow(
      /only to release-scorecard/u,
    );
  });

  it('authenticates an external manifest against its own release tarball root', () => {
    const externalRoot = mkdtempSync(path.join(tmpdir(), 'kovo-external-packed-manifest-'));
    try {
      const tarballRoot = path.join(externalRoot, '.release', 'tarballs');
      mkdirSync(tarballRoot, { recursive: true });
      const tarball = path.join(tarballRoot, 'package.tgz');
      writeFileSync(tarball, 'fixture');

      expect(
        packedTarballPath(
          path.join(externalRoot, '.release', 'packed-packages.json'),
          '.release/tarballs/package.tgz',
        ),
      ).toBe(realpathSync(tarball));
      expect(() =>
        packedTarballPath(
          path.join(externalRoot, '.release', 'packed-packages.json'),
          '../outside.tgz',
        ),
      ).toThrow(/must stay inside/u);
    } finally {
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  it('keeps external manifest admission bound to the exact release inventory', () => {
    const expected = [{ name: '@kovojs/ui', version: '0.2.0' }];
    const manifest = {
      schema: 'kovo.packed-public-packages/v2',
      packages: [
        {
          files: ['package/package.json'],
          manifest: { name: '@kovojs/ui', version: '0.2.0' },
          name: '@kovojs/ui',
          sha512: 'sha512-YQ==',
          tarball: '.release/tarballs/kovojs-ui-0.2.0.tgz',
          version: '0.2.0',
        },
      ],
    };

    expect(validateExternalPackedJourneyManifest(manifest, expected)).toBe(manifest.packages);
    const substituted = structuredClone(manifest);
    substituted.packages[0].name = '@kovojs/icons';
    expect(() => validateExternalPackedJourneyManifest(substituted, expected)).toThrow(
      /package 0 is invalid/u,
    );
  });
});

function authenticatedRecord(identity, tarballPath, tarballBytes) {
  return Object.freeze({
    entries: Object.freeze([
      Object.freeze({ data: Buffer.from(identity), name: 'package/identity.txt' }),
    ]),
    manifest: Object.freeze({ name: '@kovojs/core', version: '0.3.0' }),
    name: '@kovojs/core',
    sha512: `sha512-${createHash('sha512').update(tarballBytes).digest('base64')}`,
    tarballPath,
    version: '0.3.0',
  });
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function manifestIdentity(bytes) {
  return JSON.parse(bytes.toString('utf8')).identity;
}
