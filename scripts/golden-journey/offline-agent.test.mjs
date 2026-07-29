import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  diagnosticEnvelopeVersion,
  docsResultVersion,
  introduceMissingAccess,
  offlineCommandEnvironment,
  parseDiagnosticObservation,
  repairMissingAccess,
  rewriteScaffoldDependenciesToPackedTarballs,
  runOfflineAgentJourney,
  validateInstalledDocsObservation,
} from './offline-agent.mjs';

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('offline agent diagnostic boundary', () => {
  it('accepts only the exact JSON envelope on the exit-owned stream', () => {
    const sourceRoot = temporaryRoot('diagnostic');
    const failure = observation({
      status: 1,
      stderr: diagnosticJson([diagnosticRecord()]),
    });
    const success = observation({
      status: 0,
      stdout: diagnosticJson([]),
    });

    expect(parseDiagnosticObservation(failure, { expectedExitCode: 1, sourceRoot })).toEqual([
      diagnosticRecord(),
    ]);
    expect(parseDiagnosticObservation(success, { expectedExitCode: 0, sourceRoot })).toEqual([]);
  });

  it('rejects prose, side-channel output, missing fields, and exit/envelope contradictions', () => {
    const sourceRoot = temporaryRoot('hostile-diagnostic');
    const valid = diagnosticRecord();

    expect(() =>
      parseDiagnosticObservation(
        observation({
          status: 1,
          stderr: `ERROR KV436 Missing access\n${diagnosticJson([valid])}`,
        }),
        { expectedExitCode: 1, sourceRoot },
      ),
    ).toThrow(/exactly one JSON object/);
    expect(() =>
      parseDiagnosticObservation(
        observation({
          status: 1,
          stderr: diagnosticJson([valid]),
          stdout: 'human fallback\n',
        }),
        { expectedExitCode: 1, sourceRoot },
      ),
    ).toThrow(/non-JSON side-channel/);
    const { help: _help, ...missingHelp } = valid;
    expect(() =>
      parseDiagnosticObservation(
        observation({ status: 1, stderr: diagnosticJson([missingHelp]) }),
        { expectedExitCode: 1, sourceRoot },
      ),
    ).toThrow(/contain exactly/);
    expect(() =>
      parseDiagnosticObservation(observation({ status: 0, stdout: diagnosticJson([valid]) }), {
        expectedExitCode: 0,
        sourceRoot,
      }),
    ).toThrow(/empty diagnostics array/);
    expect(() =>
      parseDiagnosticObservation(observation({ status: 1, stderr: diagnosticJson([]) }), {
        expectedExitCode: 1,
        sourceRoot,
      }),
    ).toThrow(/at least one diagnostic/);
    expect(() =>
      parseDiagnosticObservation(observation({ status: 1, stderr: diagnosticJson([valid]) }), {
        expectedExitCode: 0,
        sourceRoot,
      }),
    ).toThrow(/KV436/);
  });

  it('rejects source anchors that escape the scaffold root', () => {
    const sourceRoot = temporaryRoot('source-root');
    expect(() =>
      parseDiagnosticObservation(
        observation({
          status: 1,
          stderr: diagnosticJson([
            diagnosticRecord({ source: { end: 2, file: '../outside.ts', start: 1 } }),
          ]),
        }),
        { expectedExitCode: 1, sourceRoot },
      ),
    ).toThrow(/escapes the scaffold root/);
  });
});

describe('offline agent local-doc boundary', () => {
  it('accepts excerpts only when the installed pointer, bytes, digests, and version agree', () => {
    const fixture = installedDocsFixture(
      'KV436 requires an explicit access decision. Use access: [guard] or publicAccess(...).\n',
    );
    const result = {
      excerpt: fixture.content,
      path: fixture.path,
      sha256: fixture.sha256,
      snapshotDigest: fixture.snapshotDigest,
      version: fixture.version,
    };

    expect(
      validateInstalledDocsObservation(
        observation({
          status: 0,
          stdout: `${JSON.stringify({ results: [result], version: docsResultVersion })}\n`,
        }),
        { appRoot: fixture.appRoot },
      ),
    ).toEqual([result]);
  });

  it('rejects live-looking paths, stale snapshots, copied excerpts, and human output', () => {
    const fixture = installedDocsFixture(
      'KV436 requires an explicit access decision. Use access: [guard].\n',
    );
    const base = {
      excerpt: fixture.content,
      path: fixture.path,
      sha256: fixture.sha256,
      snapshotDigest: fixture.snapshotDigest,
      version: fixture.version,
    };
    const run = (result, stdoutPrefix = '') =>
      validateInstalledDocsObservation(
        observation({
          status: 0,
          stdout: `${stdoutPrefix}${JSON.stringify({
            results: [result],
            version: docsResultVersion,
          })}\n`,
        }),
        { appRoot: fixture.appRoot },
      );

    expect(() => run({ ...base, path: 'https://docs.example.test/KV436' })).toThrow(/malformed/);
    expect(() => run({ ...base, snapshotDigest: digest('stale') })).toThrow(/does not match/);
    expect(() => run({ ...base, excerpt: 'copied live documentation' })).toThrow(
      /not authenticated/,
    );
    expect(() => run(base, 'Fetched docs:\n')).toThrow(/exactly one JSON object/);
  });
});

describe('offline agent edit and repair', () => {
  const original = [
    "import { appAuthed } from './auth.js';",
    '',
    '// Its KV436 access decision is the session-presence guard.',
    'export const contactsQuery = query({',
    '  access: [appAuthed],',
    '  async load() { return { items: [] }; },',
    '});',
    '',
  ].join('\n');

  it('repairs the deliberate edit only after both KV436 and installed guidance agree', () => {
    const edited = introduceMissingAccess(original);
    const docs = [
      {
        excerpt:
          'KV436 requires an explicit access decision. Use access: [guard] or publicAccess(...).',
      },
    ];

    expect(
      repairMissingAccess({
        diagnostic: diagnosticRecord(),
        docs,
        source: edited,
      }),
    ).toBe(original);
  });

  it('does not repair from a wrong code, unauthenticated prose, or ambiguous source shape', () => {
    const edited = introduceMissingAccess(original);
    const docs = [
      {
        excerpt:
          'KV436 requires an explicit access decision. Use access: [guard] or publicAccess(...).',
      },
    ];
    expect(() =>
      repairMissingAccess({
        diagnostic: diagnosticRecord({ code: 'KV423' }),
        docs,
        source: edited,
      }),
    ).toThrow(/KV436/);
    expect(() =>
      repairMissingAccess({
        diagnostic: diagnosticRecord(),
        docs: [{ excerpt: 'A generic query guide.' }],
        source: edited,
      }),
    ).toThrow(/do not explain/);
    expect(() =>
      repairMissingAccess({
        diagnostic: diagnosticRecord(),
        docs,
        source: `${edited}\nexport const contactsQuery = query({\n`,
      }),
    ).toThrow(/guard context/);
  });
});

describe('offline agent process and package posture', () => {
  it('runs the edit and repair loop through current-source check rather than deployment build', () => {
    const parent = temporaryRoot('journey');
    const packages = packedPackageFixtures(parent);
    const source = [
      "import { appAuthed } from './auth.js';",
      '',
      '// Its KV436 access decision is the session-presence guard.',
      'export const contactsQuery = query({',
      '  access: [appAuthed],',
      '  async load() { return { items: [] }; },',
      '});',
      '',
    ].join('\n');
    const expectedCheckArgs = [
      'exec',
      'kovo',
      'check',
      'source',
      './src/app.tsx',
      '--no-cache',
      '--format',
      'json',
    ];
    const seenChecks = [];
    let appRoot;
    let docsFixture;

    const commandRunner = (_file, args, { cwd }) => {
      if (args[0]?.endsWith('/create-kovo/dist/index.mjs')) {
        appRoot = args[1];
        mkdirSync(path.join(appRoot, 'src'), { recursive: true });
        writeFileSync(
          path.join(appRoot, 'package.json'),
          `${JSON.stringify({
            dependencies: { '@kovojs/core': '0.2.0' },
            devDependencies: { '@kovojs/cli': '0.2.0' },
          })}\n`,
        );
        writeFileSync(path.join(appRoot, 'src/queries.ts'), source);
        return observation({ status: 0 });
      }
      if (args[0] === 'install') return observation({ status: 0 });
      if (args.join(' ') === 'exec kovo update-docs') {
        docsFixture = writeInstalledDocsFixture(
          appRoot,
          'KV436 requires an explicit access decision. Use access: [guard] or publicAccess(...).\n',
        );
        return observation({
          status: 0,
          stdout: [
            'kovo-update-docs/v1',
            'OK source=installed-package version=1.2.3 files=7',
            `OK snapshot=${docsFixture.snapshotDigest} current=.kovo/docs/current.json`,
            '',
          ].join('\n'),
        });
      }
      if (args[2] === 'check') {
        seenChecks.push(args);
        const edited = readFileSync(path.join(cwd, 'src/queries.ts'), 'utf8');
        return edited === source
          ? observation({ status: 0, stdout: diagnosticJson([]) })
          : observation({
              status: 1,
              stderr: diagnosticJson([
                diagnosticRecord({
                  source: {
                    end: edited.indexOf('async load'),
                    file: 'src/queries.ts',
                    start: edited.indexOf('export const contactsQuery'),
                  },
                }),
              ]),
            });
      }
      if (args[2] === 'docs') {
        const content = readFileSync(
          path.join(
            appRoot,
            '.kovo/docs/snapshots',
            docsFixture.snapshotDigest.slice('sha256:'.length),
            docsFixture.path,
          ),
          'utf8',
        );
        return observation({
          status: 0,
          stdout: `${JSON.stringify({
            results: [
              {
                excerpt: content,
                path: docsFixture.path,
                sha256: docsFixture.sha256,
                snapshotDigest: docsFixture.snapshotDigest,
                version: docsFixture.version,
              },
            ],
            version: docsResultVersion,
          })}\n`,
        });
      }
      throw new Error(`Unexpected offline-agent command: ${args.join(' ')}`);
    };

    const report = runOfflineAgentJourney({
      commandRunner,
      packedPackages: packages,
      temporaryParent: parent,
    });

    expect(report.pass).toBe(true);
    expect(report.diagnostics.code).toBe('KV436');
    expect(seenChecks).toEqual([expectedCheckArgs, expectedCheckArgs]);
    expect(seenChecks.flat()).not.toContain('build');
  });

  it('preserves a bounded redacted app when the aggregate offline journey fails', () => {
    const parent = temporaryRoot('failed-journey');
    const artifacts = path.join(parent, 'artifacts');
    const packages = packedPackageFixtures(parent);
    const secret = 'offline-agent-super-secret';
    const report = runOfflineAgentJourney({
      artifactRoot: artifacts,
      commandRunner: (_file, args) => {
        if (args[0]?.endsWith('/create-kovo/dist/index.mjs')) {
          const appRoot = args[1];
          mkdirSync(path.join(appRoot, 'src'), { recursive: true });
          writeFileSync(
            path.join(appRoot, 'package.json'),
            '{"dependencies":{"@kovojs/core":"0.2.0"}}\n',
          );
          writeFileSync(path.join(appRoot, '.env'), `KOVO_CSRF_SECRET=${secret}\n`);
          writeFileSync(
            path.join(appRoot, 'src/queries.ts'),
            `export const leaked = '${secret}';\n`,
          );
          return observation({ status: 0 });
        }
        return observation({ status: 1, stderr: `TOKEN=${secret}` });
      },
      packedPackages: packages,
      temporaryParent: parent,
    });

    expect(report.pass).toBe(false);
    expect(report.failure.artifact).toMatchObject({
      directory: 'failed/offline-agent',
      manifest: 'failed/offline-agent/redaction-manifest.json',
    });
    const preserved = path.join(artifacts, report.failure.artifact.directory);
    expect(readFileSync(path.join(preserved, 'app/src/queries.ts'), 'utf8')).not.toContain(secret);
    expect(readFileSync(path.join(preserved, 'redaction-manifest.json'), 'utf8')).toContain(
      'exactDiscoveredSecretsAbsent',
    );
    expect(report.failure.message).not.toContain(secret);
  });

  it('sets hard package-manager offline mode and denies loopback as well as remote egress', () => {
    const env = offlineCommandEnvironment({ PATH: process.env.PATH });
    expect(env).toMatchObject({
      KOVO_EGRESS_ALLOWLIST: '',
      KOVO_EGRESS_ALLOW_LOOPBACK: '0',
      KOVO_EGRESS_MODE: 'deny',
      npm_config_ignore_scripts: 'true',
      npm_config_offline: 'true',
      pnpm_config_ignore_scripts: 'true',
      pnpm_config_offline: 'true',
    });

    const child = spawnSync(
      process.execPath,
      ['-e', "require('node:net').connect({ host: '127.0.0.1', port: 9 });"],
      { encoding: 'utf8', env },
    );
    expect(child.status).not.toBe(0);
    expect(child.stderr).toContain('KOVO egress floor blocked net.connect to 127.0.0.1:9');
  });

  it('rewrites every first-party dependency and transitive override to authenticated tarballs', () => {
    const appRoot = temporaryRoot('package');
    writeFileSync(
      path.join(appRoot, 'package.json'),
      `${JSON.stringify({
        dependencies: { '@kovojs/core': '0.2.0', untouched: '1.0.0' },
        devDependencies: { '@kovojs/cli': '0.2.0' },
        pnpm: { overrides: { untouched: '1.0.0' } },
      })}\n`,
    );
    const packages = packedPackageFixtures(appRoot);

    rewriteScaffoldDependenciesToPackedTarballs(appRoot, packages);

    const manifest = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
    expect(manifest.dependencies['@kovojs/core']).toMatch(/^file:/);
    expect(manifest.devDependencies['@kovojs/cli']).toMatch(/^file:/);
    expect(manifest.dependencies.untouched).toBe('1.0.0');
    expect(manifest.pnpm.overrides).toMatchObject({
      '@kovojs/cli': expect.stringMatching(/^file:/),
      '@kovojs/core': expect.stringMatching(/^file:/),
      'create-kovo': expect.stringMatching(/^file:/),
      untouched: '1.0.0',
    });
  });
});

function installedDocsFixture(content) {
  const appRoot = temporaryRoot('docs');
  return writeInstalledDocsFixture(appRoot, content);
}

function writeInstalledDocsFixture(appRoot, content) {
  const snapshotDigest = digest('snapshot');
  const version = '1.2.3';
  const relativePath = 'spec/11-diagnostics.md';
  const digestDirectory = snapshotDigest.slice('sha256:'.length);
  const docsRoot = path.join(appRoot, '.kovo', 'docs');
  const file = path.join(docsRoot, 'snapshots', digestDirectory, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  writeFileSync(
    path.join(docsRoot, 'current.json'),
    `${JSON.stringify({
      publicManifestDigest: digest('manifest'),
      schema: 'kovo.installed-agent-docs-current/v1',
      snapshotDigest,
      sourceCommit: '0123456789abcdef0123456789abcdef01234567',
      version,
    })}\n`,
  );
  return {
    appRoot,
    content,
    path: relativePath,
    sha256: digest(content),
    snapshotDigest,
    version,
  };
}

function packedPackageFixtures(root) {
  return new Map(
    ['@kovojs/cli', '@kovojs/core', 'create-kovo'].map((name) => {
      const tarballPath = path.join(root, `${name.replaceAll('/', '-')}.tgz`);
      writeFileSync(tarballPath, name);
      return [
        name,
        {
          entries: [],
          name,
          sha512: `sha512-${name}`,
          tarballPath,
          version: '0.2.0',
        },
      ];
    }),
  );
}

function diagnosticRecord(overrides = {}) {
  return {
    category: 'build',
    code: 'KV436',
    help: 'Declare explicit access with a guard or publicAccess(...).',
    message: 'Query contactsQuery is missing an explicit access decision.',
    severity: 'error',
    source: { end: 40, file: 'src/queries.ts', start: 20 },
    version: diagnosticEnvelopeVersion,
    ...overrides,
  };
}

function diagnosticJson(diagnostics) {
  return `${JSON.stringify({ diagnostics, version: diagnosticEnvelopeVersion })}\n`;
}

function observation({ status, stderr = '', stdout = '' }) {
  return { durationMs: 1, signal: null, status, stderr, stdout };
}

function temporaryRoot(label) {
  const root = mkdtempSync(path.join(tmpdir(), `kovo-offline-agent-${label}-`));
  roots.push(root);
  return root;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
