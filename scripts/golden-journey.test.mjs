import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

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
import { canonicalizeTarballBytes } from './lib/deterministic-tarball.mjs';
import { manifestPath, releasePackages, repoRoot } from './release-packages.mjs';

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

  it('selects local or external validation from the manifest path after parsing bytes', () => {
    const bytes = Buffer.from('{"fixture":"parsed"}\n');
    const expectedPackages = [{ name: '@kovojs/core', version: '0.3.0' }];
    const calls = [];
    const dependencies = {
      releasePackages: () => expectedPackages,
      validateExternalManifest(manifest, expected) {
        calls.push({ branch: 'external', expected, manifest });
        return [];
      },
      validateLocalManifest(manifest, expected) {
        calls.push({ branch: 'local', expected, manifest });
        return [];
      },
    };

    expect(
      authenticatedPackedJourneyPackagesFromManifestBytes(manifestPath, bytes, dependencies),
    ).toEqual(new Map());
    expect(
      authenticatedPackedJourneyPackagesFromManifestBytes(
        path.join(tmpdir(), 'external-release', '.release', 'packed-packages.json'),
        bytes,
        dependencies,
      ),
    ).toEqual(new Map());
    expect(calls).toEqual([
      { branch: 'local', expected: expectedPackages, manifest: { fixture: 'parsed' } },
      { branch: 'external', expected: expectedPackages, manifest: { fixture: 'parsed' } },
    ]);
  });

  it('authenticates authoritative A bytes while an external path exposes valid B', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-packed-manifest-aba-'));
    try {
      const packedManifestPath = path.join(root, '.release', 'packed-packages.json');
      const releaseA = externalPackedReleaseFixture(root, 'A');
      const releaseB = externalPackedReleaseFixture(root, 'B');
      writeFileSync(packedManifestPath, releaseA.manifestBytes);
      const transitions = [];
      let readCount = 0;

      const result = loadAuthenticatedPackedConsumerInputs(packedManifestPath, {
        readManifestBytes(resolvedManifest) {
          readCount += 1;
          if (readCount === 2) {
            transitions.push(
              `before-restore:${packedManifestIdentity(readFileSync(resolvedManifest))}`,
            );
            writeFileSync(resolvedManifest, releaseA.manifestBytes);
            transitions.push('restore:A');
          }
          const captured = readFileSync(resolvedManifest);
          transitions.push(`read-${String(readCount)}:${packedManifestIdentity(captured)}`);
          if (readCount === 1) {
            writeFileSync(resolvedManifest, releaseB.manifestBytes);
            transitions.push('swap:B');
          }
          return captured;
        },
      });

      expect(transitions).toEqual([
        'read-1:A',
        'swap:B',
        'before-restore:B',
        'restore:A',
        'read-2:A',
      ]);
      expect(result.manifestSha256).toBe(sha256(releaseA.manifestBytes));
      expect(result.packages.size).toBe(releasePackages().length);
      for (const [name, pkg] of result.packages) {
        const expectedA = releaseA.packages.get(name);
        const validB = releaseB.packages.get(name);
        expect(pkg).toMatchObject({
          sha512: expectedA.sha512,
          tarballPath: realpathSync(expectedA.tarballPath),
        });
        expect(pkg.tarballBytes).toEqual(expectedA.tarballBytes);
        expect(pkg.entries.find((entry) => entry.name === 'package/identity.txt')?.data).toEqual(
          Buffer.from(`A:${name}`),
        );
        expect(pkg.sha512).not.toBe(validB.sha512);
        expect(pkg.tarballPath).not.toBe(realpathSync(validB.tarballPath));
      }
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

function externalPackedReleaseFixture(root, identity) {
  const tarballRoot = path.join(root, '.release', 'tarballs');
  mkdirSync(tarballRoot, { recursive: true });
  const packages = new Map();
  const manifestPackages = releasePackages().map(({ name, version }, index) => {
    const manifest = { fixtureIdentity: identity, name, version };
    const tarballBytes = canonicalizeTarballBytes(
      fixtureTarball([
        fixtureTarEntry('package/package.json', JSON.stringify(manifest)),
        fixtureTarEntry('package/identity.txt', `${identity}:${name}`),
      ]),
    );
    const tarballName = `${identity.toLowerCase()}-${String(index).padStart(2, '0')}.tgz`;
    const tarballPath = path.join(tarballRoot, tarballName);
    const sha512 = `sha512-${createHash('sha512').update(tarballBytes).digest('base64')}`;
    writeFileSync(tarballPath, tarballBytes);
    packages.set(name, { sha512, tarballBytes, tarballPath });
    return {
      files: ['package/identity.txt', 'package/package.json'],
      manifest,
      name,
      sha512,
      tarball: `.release/tarballs/${tarballName}`,
      version,
    };
  });
  return {
    manifestBytes: Buffer.from(
      `${JSON.stringify({ schema: 'kovo.packed-public-packages/v2', packages: manifestPackages })}\n`,
    ),
    packages,
  };
}

function packedManifestIdentity(bytes) {
  return JSON.parse(bytes.toString('utf8')).packages[0].manifest.fixtureIdentity;
}

function fixtureTarEntry(name, body) {
  return {
    body: Buffer.from(body),
    gid: 501,
    mode: 0o644,
    mtime: 123,
    name,
    uid: 501,
  };
}

function fixtureTarball(entries) {
  const blocks = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, 'utf8');
    writeOctal(header, 100, 108, entry.mode);
    writeOctal(header, 108, 116, entry.uid);
    writeOctal(header, 116, 124, entry.gid);
    writeOctal(header, 124, 136, entry.body.byteLength);
    writeOctal(header, 136, 148, entry.mtime);
    header.fill(0x20, 148, 156);
    header[156] = '0'.charCodeAt(0);
    Buffer.from('ustar\0').copy(header, 257);
    Buffer.from('00').copy(header, 263);
    const checksum = header
      .reduce((sum, byte) => sum + byte, 0)
      .toString(8)
      .padStart(6, '0');
    header.write(checksum, 148, 6, 'ascii');
    header[154] = 0;
    header[155] = 0x20;
    blocks.push(
      header,
      entry.body,
      Buffer.alloc(Math.ceil(entry.body.byteLength / 512) * 512 - entry.body.byteLength),
    );
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 9, mtime: 0 });
}

function writeOctal(header, start, end, value) {
  header.write(value.toString(8).padStart(end - start - 1, '0'), start, end - start - 1, 'ascii');
  header[end - 1] = 0;
}
