import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AXE_WCAG_22_AA_TAGS,
  PACKED_APPS_BUILD_POSTURE_SCHEMA,
  PACKED_APPS_CHECK_PHASE_CENSUS_SCHEMA,
  PACKED_APPS_REPORT_SCHEMA,
  PACKED_APPS_VARIANT_SCHEMA,
  PACKED_JOURNEY_PACKAGE_NAMES,
  collectInstalledDependencyMetrics,
  conceptCensus,
  declareJourneyProductionRetention,
  packedSourceCheckPhaseCensusFindings,
  parsePackedSourceCheckPhaseCensus,
  requirePackedCreatorHandoff,
  requirePackedPhaseSuccess,
  requirePackedSqliteOwnerWarnings,
  requirePackedSourceCheckSuccess,
  rewriteScaffoldDependenciesToPackedTarballs,
  sanitizeCapturedMutationResponse,
  sanitizeDiagnosticResponseHeaders,
  sanitizeMarkupPreview,
  sanitizeTargetMarkupPreview,
  selectPublicStyledButtonBackground,
  validatePackedAppsReport,
} from './packed-app.mjs';

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('packed app golden journey', () => {
  it('runs every WCAG 2.2 A/AA axe tag available to the pinned engine', () => {
    expect(AXE_WCAG_22_AA_TAGS).toEqual(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
  });

  it('proves the public primary button without mistaking an earlier outline button for a failure', () => {
    expect(
      selectPublicStyledButtonBackground([
        { background: 'rgb(239, 239, 239)', styleSource: '' },
        {
          background: 'rgba(0, 0, 0, 0)',
          styleSource: 'button.tsx#root; button.tsx#sm; button.tsx#outline',
        },
        {
          background: 'rgb(15, 139, 141)',
          styleSource: 'button.tsx#root; button.tsx#md; button.tsx#primary',
        },
      ]),
    ).toBe('rgb(15, 139, 141)');
    expect(
      selectPublicStyledButtonBackground([
        {
          background: 'rgba(0, 0, 0, 0)',
          styleSource: 'button.tsx#root; button.tsx#md; button.tsx#primary',
        },
      ]),
    ).toBe('');
  });

  it('requires the exact conditional creator handoff and SQLite warning surfaces', () => {
    const appRoot = '/tmp/kovo packed app';
    const nextSteps = [
      'Next steps',
      `  cd '${appRoot}'`,
      '  pnpm install --ignore-scripts',
      '  pnpm exec kovo check lifecycle',
      '  pnpm rebuild',
      '  pnpm run dev',
      '  pnpm run check',
      '',
    ].join('\n');
    const sqliteOutput = [
      'Kovo app created',
      '',
      `  Directory   ${appRoot}`,
      '  Name        sqlite-app',
      '  Dialect     sqlite',
      '  Deploy      node',
      '  Retention   unconfigured',
      '  Install     skipped',
      '  Git         not initialized',
      '  Files       42',
      '',
      '  WARNING SQLite is experimental and single-principal/local-dev only.',
      '  It does not provide Kovo authorization or confidentiality guarantees.',
      '  KV447: owner annotations are audit metadata, not engine-enforced access control.',
      '',
      nextSteps,
    ].join('\n');

    expect(() =>
      requirePackedCreatorHandoff(
        { stderr: '', stdout: sqliteOutput },
        { appRoot, dialect: 'sqlite', name: 'sqlite-app' },
      ),
    ).not.toThrow();
    expect(() =>
      requirePackedCreatorHandoff(
        { stderr: '', stdout: sqliteOutput.replace('  pnpm run check\n', '') },
        { appRoot, dialect: 'sqlite', name: 'sqlite-app' },
      ),
    ).toThrow(/install, dev, and check/u);

    const warnings = [
      'WARN KV447 src/schema.sqlite.ts:45 Table session declares owner scoping',
      'WARN KV447 src/schema.sqlite.ts:72 Table account declares owner scoping',
    ].join('\n');
    expect(() =>
      requirePackedSqliteOwnerWarnings('sqlite', 'check', { stderr: '', stdout: warnings }),
    ).not.toThrow();
    expect(() =>
      requirePackedSqliteOwnerWarnings('sqlite', 'build', {
        stderr: '',
        stdout: warnings.replace('Table account', 'Table audit'),
      }),
    ).toThrow(/account/u);
    expect(() =>
      requirePackedSqliteOwnerWarnings('postgres', 'dev', {
        stderr: '',
        stdout: warnings,
      }),
    ).toThrow(/SQLite-only KV447/u);
  });

  it('retains streamed response shape without persisting credential-bearing attributes', () => {
    const captured = sanitizeCapturedMutationResponse({
      chunks: ['<input value="csrf-secret"', ' data-live="attestation-secret">created</input>'],
      complete: true,
      error: null,
      headers: { 'content-type': 'text/vnd.kovo.fragment+html' },
      status: 200,
      url: 'http://127.0.0.1/_m/mutations/add-contact',
    });

    expect(captured.chunks).toEqual([
      { bytes: 26, index: 0 },
      { bytes: 47, index: 1 },
    ]);
    expect(captured.bodyPreview).toContain('created');
    expect(captured.bodyPreview).not.toContain('csrf-secret');
    expect(captured.bodyPreview).not.toContain('attestation-secret');
    expect(sanitizeMarkupPreview(`token=${'a'.repeat(64)}`, 1_024)).not.toContain('a'.repeat(64));
    const targetMarkup = sanitizeTargetMarkupPreview(
      `<div kovo-c="contacts" kovo-deps="contacts-query" kovo-live="contacts#region@${'a'.repeat(64)}:{}"><form action="/_m/mutations/add-contact"><input name="email" value="private@example.test"></form></div>`,
      4_096,
    );
    expect(targetMarkup).toContain('kovo-c="contacts"');
    expect(targetMarkup).toContain('kovo-deps="contacts-query"');
    expect(targetMarkup).toContain('kovo-live="contacts#region@[REDACTED:ATTESTATION]:{}"');
    expect(targetMarkup).toContain('action="/_m/mutations/add-contact"');
    expect(targetMarkup).not.toContain('private@example.test');
    expect(
      sanitizeDiagnosticResponseHeaders({
        'content-type': 'text/vnd.kovo.fragment+html',
        'kovo-build': 'build-1',
        'set-cookie': 'session=private',
      }),
    ).toEqual({
      'content-type': 'text/vnd.kovo.fragment+html',
      'kovo-build': 'build-1',
    });
  });

  it('rewrites every direct and transitive Kovo edge to authenticated tarball files', () => {
    const root = temporaryRoot();
    writeFileSync(
      path.join(root, 'package.json'),
      `${JSON.stringify(
        {
          dependencies: { '@kovojs/core': '0.2.0', external: '1.0.0' },
          devDependencies: { '@kovojs/cli': '0.2.0' },
          pnpm: { overrides: { external: '1.0.0' } },
        },
        null,
        2,
      )}\n`,
    );
    const packages = new Map([
      ['@kovojs/core', { tarballPath: path.join(root, 'core.tgz') }],
      ['@kovojs/cli', { tarballPath: path.join(root, 'cli.tgz') }],
      ['@kovojs/server', { tarballPath: path.join(root, 'server.tgz') }],
    ]);

    rewriteScaffoldDependenciesToPackedTarballs(root, packages);

    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(manifest.dependencies.external).toBe('1.0.0');
    expect(manifest.dependencies['@kovojs/core']).toMatch(/^file:\/\//u);
    expect(manifest.devDependencies['@kovojs/cli']).toMatch(/^file:\/\//u);
    expect(manifest.pnpm.overrides).toMatchObject({
      external: '1.0.0',
      '@kovojs/core': expect.stringMatching(/^file:\/\//u),
      '@kovojs/cli': expect.stringMatching(/^file:\/\//u),
      '@kovojs/server': expect.stringMatching(/^file:\/\//u),
    });
  });

  it('counts imports, bindings, config keys, creator inputs, prompts, and env edits separately', () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, 'src'), { recursive: true });
    writeFileSync(
      path.join(root, 'src', 'app.tsx'),
      [
        "import { component, type ComponentChild } from '@kovojs/core';",
        "import * as server from '@kovojs/server';",
        'void component; void server; type Child = ComponentChild;',
      ].join('\n'),
    );
    writeFileSync(
      path.join(root, 'kovo.config.ts'),
      [
        "import { defineConfig, node } from '@kovojs/server/build';",
        'export default defineConfig({',
        '  preset: node({ retention: { hours: 24 } }),',
        "  generated: { directory: '.kovo/generated' },",
        '});',
      ].join('\n'),
    );
    writeFileSync(path.join(root, '.env'), 'KOVO_CSRF_SECRET=fake-fixture-secret\n');
    const digest = digestFile(path.join(root, '.env'));

    const census = conceptCensus(root, {
      beforeCrudEnvDigest: digest,
      creatorInputs: ['--name', '--postgres', '--disable-git'],
      interactivePrompts: [],
      scaffoldEnvDigest: digest,
    });

    expect(census.frameworkImports).toEqual([
      '@kovojs/core',
      '@kovojs/server',
      '@kovojs/server/build',
    ]);
    expect(census.frameworkBindings).toContain('@kovojs/core#component');
    expect(census.frameworkBindings).toContain('@kovojs/core#ComponentChild');
    expect(census.frameworkBindings).toContain('@kovojs/server#*');
    expect(census.configKeys).toEqual(['generated', 'generated.directory', 'preset']);
    expect(census.counts).toMatchObject({
      creatorInputs: 3,
      environmentEdits: 0,
      interactivePrompts: 0,
    });

    writeFileSync(path.join(root, '.env'), 'KOVO_CSRF_SECRET=edited-fixture-secret\n');
    expect(
      conceptCensus(root, {
        beforeCrudEnvDigest: digestFile(path.join(root, '.env')),
        creatorInputs: [],
        interactivePrompts: [],
        scaffoldEnvDigest: digest,
      }).environmentEdits,
    ).toEqual([{ kind: 'content-changed', path: '.env' }]);
  });

  it('records an explicit controlled retention posture only for the production build fixture', () => {
    const root = temporaryRoot();
    writeFileSync(
      path.join(root, 'kovo.config.ts'),
      [
        "import { defineConfig, node } from '@kovojs/server/build';",
        'export default defineConfig({',
        '  preset: node(),',
        '});',
      ].join('\n'),
    );

    const posture = declareJourneyProductionRetention(root);

    expect(posture).toEqual({
      schema: PACKED_APPS_BUILD_POSTURE_SCHEMA,
      configPath: 'kovo.config.ts',
      kind: 'controlled-retained-local-fixture',
      retention: {
        hours: 24,
        immutableClientModules: 'retained',
        priorTokenQueryReads: 'retained',
      },
    });
    expect(readFileSync(path.join(root, 'kovo.config.ts'), 'utf8')).toBe(
      [
        "import { defineConfig, node } from '@kovojs/server/build';",
        'export default defineConfig({',
        '  preset: node({',
        '    retention: {',
        '      hours: 24,',
        "      immutableClientModules: 'retained',",
        "      priorTokenQueryReads: 'retained',",
        '    },',
        '  }),',
        '});',
      ].join('\n'),
    );
  });

  it('measures physical install bytes and unique production package identities', () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, 'node_modules', 'a'), { recursive: true });
    writeFileSync(
      path.join(root, 'package.json'),
      '{"dependencies":{"a":"1.0.0"},"optionalDependencies":{"b":"2.0.0"}}\n',
    );
    writeFileSync(path.join(root, 'node_modules', 'a', 'index.js'), '12345');

    const metrics = collectInstalledDependencyMetrics(root, () => ({
      durationMs: 1,
      error: null,
      exitCode: 0,
      peakRssBytes: 1,
      signal: null,
      stderr: '',
      stdout: JSON.stringify([
        {
          dependencies: {
            a: {
              name: 'a',
              version: '1.0.0',
              dependencies: { c: { name: 'c', version: '3.0.0' } },
            },
          },
        },
      ]),
    }));

    expect(metrics).toEqual({
      directProductionDependencies: 2,
      installedBytes: 5,
      installedFiles: 1,
      transitiveProductionDependencies: 1,
    });
  });

  it('fails closed when a passing report omits a journey phase, a11y, or zero-edit proof', () => {
    const report = successfulReport();
    expect(validatePackedAppsReport(report)).toEqual([]);

    const missingBuild = structuredClone(report);
    missingBuild.variants[0].phases = missingBuild.variants[0].phases.filter(
      (phase) => phase.name !== 'build',
    );
    expect(validatePackedAppsReport(missingBuild)).toContain(
      'variants[0] is missing successful phase build',
    );

    const testBeforeBuild = structuredClone(report);
    const buildIndex = testBeforeBuild.variants[0].phases.findIndex(
      (phase) => phase.name === 'build',
    );
    const testIndex = testBeforeBuild.variants[0].phases.findIndex(
      (phase) => phase.name === 'test',
    );
    [
      testBeforeBuild.variants[0].phases[buildIndex],
      testBeforeBuild.variants[0].phases[testIndex],
    ] = [
      testBeforeBuild.variants[0].phases[testIndex],
      testBeforeBuild.variants[0].phases[buildIndex],
    ];
    expect(validatePackedAppsReport(testBeforeBuild)).toContain(
      'variants[0] does not retain the exact successful phase order',
    );

    const hiddenViolation = structuredClone(report);
    hiddenViolation.variants[0].accessibility.violations = 1;
    expect(validatePackedAppsReport(hiddenViolation)).toContain(
      'variants[0] did not prove an axe-clean styled UI',
    );

    const internalStyleApi = structuredClone(report);
    internalStyleApi.variants[0].concepts.frameworkImports.push('@kovojs/style/internal');
    expect(validatePackedAppsReport(internalStyleApi)).toContain(
      'variants[0] styled starter imported an internal/generated Kovo API',
    );

    const browserDefaultButton = structuredClone(report);
    browserDefaultButton.variants[0].styledUi.styled.buttonBackground = 'rgba(0, 0, 0, 0)';
    expect(validatePackedAppsReport(browserDefaultButton)).toContain(
      'variants[0] did not retain an authenticated styled-UI screenshot',
    );

    const missingDialect = structuredClone(report);
    missingDialect.variants.pop();
    expect(validatePackedAppsReport(missingDialect)).toContain('variants omit sample 0 sqlite');

    const sqliteOnly = structuredClone(report);
    sqliteOnly.dialects = ['sqlite'];
    sqliteOnly.variants = sqliteOnly.variants.filter((variant) => variant.dialect === 'sqlite');
    expect(validatePackedAppsReport(sqliteOnly)).toEqual([]);
  });

  it('retains failed command timing and process-tree RSS evidence', () => {
    let failure;
    try {
      requirePackedPhaseSuccess('build', {
        durationMs: 600_001,
        error: 'command exceeded 600000ms',
        exitCode: null,
        peakRssBytes: 3_000_000_000,
        signal: 'SIGKILL',
        stderr: '',
        stdout: '',
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      evidence: {
        durationMs: 600_001,
        name: 'build',
        peakProcessTreeRssBytes: 3_000_000_000,
        status: null,
      },
      phase: 'build',
    });
  });

  it('requires the packed starter check to execute every diagnostic-producing phase', () => {
    const census = successfulCheckPhaseCensus();
    const output = [
      'kovo-check/v1',
      'OK',
      `${PACKED_APPS_CHECK_PHASE_CENSUS_SCHEMA} ${JSON.stringify(census)}`,
      '',
    ].join('\n');

    expect(parsePackedSourceCheckPhaseCensus(output)).toEqual(census);
    expect(
      requirePackedSourceCheckSuccess({
        durationMs: 4_200,
        error: null,
        exitCode: 0,
        peakRssBytes: 512_000_000,
        signal: null,
        stderr: '',
        stdout: output,
      }),
    ).toEqual({
      durationMs: 4_200,
      name: 'check',
      peakProcessTreeRssBytes: 512_000_000,
      sourceCheckPhaseCensus: census,
      status: 0,
    });

    const dropped = structuredClone(census);
    dropped.phases.splice(3, 1);
    expect(packedSourceCheckPhaseCensusFindings(dropped)).toContain(
      'kovo-check-phase-census/v1.phases must contain all 11 check phases',
    );

    const skipped = structuredClone(census);
    skipped.phases[4].status = 'not-applicable';
    expect(packedSourceCheckPhaseCensusFindings(skipped)).toContain(
      'kovo-check-phase-census/v1.phases[4] must prove executed sound-subset with a finite duration',
    );

    expect(() =>
      requirePackedSourceCheckSuccess({
        durationMs: 4_200,
        error: null,
        exitCode: 0,
        peakRssBytes: 512_000_000,
        signal: null,
        stderr: '',
        stdout: 'kovo-check/v1\nOK\n',
      }),
    ).toThrow('complete authenticated phase census');
  });
});

function successfulReport() {
  return {
    schema: PACKED_APPS_REPORT_SCHEMA,
    scenario: 'packed-apps',
    sampleCount: 1,
    dialects: ['postgres', 'sqlite'],
    packageSet: PACKED_JOURNEY_PACKAGE_NAMES.map((name) => ({
      name,
      sha512: 'sha512-YQ==',
      version: '0.2.0',
    })),
    variants: ['postgres', 'sqlite'].map((dialect) => ({
      schema: PACKED_APPS_VARIANT_SCHEMA,
      dialect,
      sampleIndex: 0,
      pass: true,
      phases: [
        'create',
        'install',
        'ready',
        'first-200',
        'login',
        'crud',
        'ready-warm',
        'check',
        'build',
        'test',
      ].map((name) => ({
        durationMs: 1,
        name,
        ...(name === 'check' ? { sourceCheckPhaseCensus: successfulCheckPhaseCensus() } : {}),
        status: 0,
      })),
      install: {
        directProductionDependencies: 5,
        durationMs: 1,
        installedBytes: 1_024,
        installedFiles: 10,
        transitiveProductionDependencies: 5,
      },
      concepts: {
        counts: { environmentEdits: 0 },
        frameworkImports: [
          '@kovojs/server',
          '@kovojs/style',
          '@kovojs/ui/badge',
          '@kovojs/ui/button',
          '@kovojs/ui/card',
        ],
        frameworkBindings: [
          '@kovojs/server#stylesheet',
          '@kovojs/style#*',
          '@kovojs/ui/badge#Badge',
          '@kovojs/ui/button#Button',
          '@kovojs/ui/card#Card',
        ],
      },
      buildPosture: {
        schema: PACKED_APPS_BUILD_POSTURE_SCHEMA,
        configPath: 'kovo.config.ts',
        kind: 'controlled-retained-local-fixture',
        retention: {
          hours: 24,
          immutableClientModules: 'retained',
          priorTokenQueryReads: 'retained',
        },
      },
      styledUi: {
        bytes: 1_024,
        path: `evidence/${dialect}-1/styled-ui.png`,
        sha256: `sha256:${'a'.repeat(64)}`,
        styled: {
          buttonBackground: 'rgb(0, 0, 0)',
          fontFamily: 'Inter',
          styleSheets: 1,
          styledSourceElements: 1,
        },
      },
      accessibility: {
        schema: 'kovo.golden-journey/accessibility/v1',
        states: [
          { name: 'login', violations: [] },
          { name: 'authenticated-crud', violations: [] },
        ],
        violations: 0,
      },
      failure: null,
    })),
    pass: true,
  };
}

function successfulCheckPhaseCensus() {
  return {
    checkGraphDigest: `sha256:${'a'.repeat(64)}`,
    phases: [
      'lifecycle-policy',
      'config-trust',
      'typescript',
      'project-quality',
      'sound-subset',
      'session-authority',
      'app-source-trust',
      'stylesheet',
      'app-evaluation',
      'build-check-graph',
      'graph-diagnostics',
    ].map((name, index) => ({ durationMs: index + 1, name, status: 'executed' })),
    schema: PACKED_APPS_CHECK_PHASE_CENSUS_SCHEMA,
    source: {
      codeUnitLength: 123,
      contentHash: `sha256:${'b'.repeat(64)}`,
      encoding: 'utf16le',
      path: 'src/app.tsx',
    },
  };
}

function temporaryRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-packed-app-test-'));
  roots.push(root);
  return root;
}

function digestFile(file) {
  const { createHash } = requireNodeCrypto();
  return `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
}

function requireNodeCrypto() {
  return globalThis.process.getBuiltinModule('node:crypto');
}
