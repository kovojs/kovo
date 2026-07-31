import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  APP_COMPONENT_SOURCE_CENSUS_SCHEMA,
  BUILT_ARTIFACT_INSPECTION_SCHEMA,
  RELEASE_ARTIFACT_INSPECTION_SCHEMA,
  RUNTIME_WIRE_INSPECTION_SCHEMA,
  censusTrackedAppComponents,
  inspectBuiltArtifact,
  validateMutationWireFrame,
  validateReleaseArtifactInspectionReport,
  validateStructuredDiagnosticEnvelope,
} from './release-artifact-inspection.mjs';

const roots = [];
const sha256 = `sha256:${'a'.repeat(64)}`;
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('final release artifact/source inspection', () => {
  it('censuses tracked component calls and requires TSX/JSX authored source', () => {
    const root = temporaryRoot();
    write(root, 'apps/one.tsx', componentSource);
    const census = censusTrackedAppComponents({
      root,
      sourceRoots: ['apps'],
      trackedFiles: ['apps/one.tsx'],
    });

    expect(census).toMatchObject({
      schema: APP_COMPONENT_SOURCE_CENSUS_SCHEMA,
      componentCalls: 1,
      componentFiles: 1,
      findings: [],
      pass: true,
    });
    expect(census.components[0]).toMatchObject({
      componentCalls: 1,
      file: 'apps/one.tsx',
      jsxNodes: 1,
    });
  });

  it('keeps the tracked repository-wide app-component census TSX/JSX-only', () => {
    const census = censusTrackedAppComponents({
      root: repositoryRoot,
    });

    expect(census.pass).toBe(true);
    expect(census.componentFiles).toBeGreaterThan(100);
    expect(census.componentCalls).toBeGreaterThanOrEqual(census.componentFiles);
    expect(census.trackedSourceFiles).toBeGreaterThan(census.componentFiles);
  });

  it('fails the census for non-TSX components, missing JSX, lowered headers, and packed KV235', () => {
    for (const [name, source, expected] of [
      ['apps/component.ts', componentSource, /not authored in TSX\/JSX/u],
      [
        'apps/component.tsx',
        componentSource.replace('return <div>Hello</div>;', "return 'Hello';"),
        /contains no authored JSX|hand-author string\/lowered IR/u,
      ],
      [
        'apps/component.tsx',
        `// @kovojs-ir\n${componentSource}`,
        /starts with compiler lowered IR/u,
      ],
      [
        'apps/component.tsx',
        componentSource.replace(
          'return <div>Hello</div>;',
          'return `<div data-bind="query.name">Hello</div>`;',
        ),
        /hand-author string\/lowered IR/u,
      ],
    ]) {
      const root = temporaryRoot();
      write(root, name, source);
      expect(() =>
        censusTrackedAppComponents({
          root,
          sourceRoots: ['apps'],
          trackedFiles: [name],
        }),
      ).toThrow(expected);
    }
  });

  it('rejects compiler-owned imports from tracked app-component source', () => {
    const root = temporaryRoot();
    write(
      root,
      'apps/one.tsx',
      [
        "import { component } from '@kovojs/core';",
        "import { securityHandler } from '@kovojs/browser/generated';",
        'export const One = component({ render() { return <div>Hello</div>; } });',
        'void securityHandler;',
        '',
      ].join('\n'),
    );

    expect(() =>
      censusTrackedAppComponents({
        root,
        sourceRoots: ['apps'],
        trackedFiles: ['apps/one.tsx'],
      }),
    ).toThrow(/compiler-owned @kovojs\/browser\/generated/u);
  });

  it('inspects authenticated graph, server/client modules, and CSS as one artifact', () => {
    const root = builtArtifactFixture();
    const inspected = inspectBuiltArtifact({
      distRoot: path.join(root, 'dist'),
      packedPackages: authenticatedPackages(),
    });

    expect(inspected.report).toMatchObject({
      schema: BUILT_ARTIFACT_INSPECTION_SCHEMA,
      pass: true,
      graph: {
        graphSchemaVersion: 'kovo.graph/v2',
        frameworkPackages: expect.arrayContaining([{ name: '@kovojs/compiler', version: '0.3.0' }]),
      },
    });
    expect(inspected.report.serverModules.map((entry) => entry.path)).toEqual([
      'server/handler.mjs',
      'server.mjs',
    ]);
    expect(inspected.report.clientModules[0].path).toMatch(/c\/__v\/[0-9a-f]{64}/u);
  });

  it('fails built inspection on graph-package drift, missing client modules, and symlinks', () => {
    const mismatched = builtArtifactFixture();
    const graphPath = path.join(mismatched, 'dist/.kovo/graph.json');
    const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
    graph.provenance.frameworkPackages[0].version = '9.9.9';
    writeFileSync(graphPath, `${JSON.stringify(graph)}\n`);
    expect(() =>
      inspectBuiltArtifact({
        distRoot: path.join(mismatched, 'dist'),
        packedPackages: authenticatedPackages(),
      }),
    ).toThrow(/absent from authenticated tarballs/u);

    const missingClient = builtArtifactFixture();
    rmSync(path.join(missingClient, 'dist/server/client'), { recursive: true });
    mkdirSync(path.join(missingClient, 'dist/server/client'));
    expect(() =>
      inspectBuiltArtifact({
        distRoot: path.join(missingClient, 'dist'),
        packedPackages: authenticatedPackages(),
      }),
    ).toThrow(/no client modules/u);

    const linked = builtArtifactFixture();
    symlinkSync(
      path.join(linked, 'dist/server/server.mjs'),
      path.join(linked, 'dist/server/linked.mjs'),
    );
    expect(() =>
      inspectBuiltArtifact({
        distRoot: path.join(linked, 'dist'),
        packedPackages: authenticatedPackages(),
      }),
    ).toThrow(/contains symlink/u);
  });

  it('requires exact structured check envelopes and a representative fragment wire', () => {
    const envelope = diagnosticEnvelope(0, []);
    expect(validateStructuredDiagnosticEnvelope(envelope, { expectedExitCode: 0 })).toEqual([]);
    expect(
      validateStructuredDiagnosticEnvelope(
        { ...envelope, diagnostics: [{ code: 'KV235', message: 'missing version' }] },
        { expectedExitCode: 0 },
      ),
    ).toContain('structured diagnostic envelope diagnostics[0] is malformed');

    const response = new Response(
      '<kovo-query name="contacts"></kovo-query><kovo-fragment target="contacts-region">artifact@example.test</kovo-fragment>',
      {
        headers: {
          'content-type': 'text/vnd.kovo.fragment+html',
          'kovo-build': 'b'.repeat(64),
        },
      },
    );
    expect(() =>
      validateMutationWireFrame({
        buildToken: 'b'.repeat(64),
        email: 'artifact@example.test',
        frame:
          '<kovo-query name="contacts"></kovo-query><kovo-fragment target="contacts-region">artifact@example.test</kovo-fragment>',
        response,
        target: 'contacts-region',
      }),
    ).not.toThrow();
    expect(() =>
      validateMutationWireFrame({
        buildToken: 'b'.repeat(64),
        email: 'artifact@example.test',
        frame: '<kovo-query name="contacts"></kovo-query>',
        response,
        target: 'contacts-region',
      }),
    ).toThrow(/omits query, fragment, target, or changed data/u);
  });

  it('keeps every evidence class mandatory in the retained report', () => {
    const report = successfulReport();
    expect(validateReleaseArtifactInspectionReport(report)).toEqual([]);

    const missingGraph = structuredClone(report);
    missingGraph.retained = missingGraph.retained.filter((entry) => entry.path !== 'graph.json');
    expect(validateReleaseArtifactInspectionReport(missingGraph)).toContain(
      'retained evidence omits graph.json',
    );

    const missingClient = structuredClone(report);
    missingClient.artifact.clientModules = [];
    expect(validateReleaseArtifactInspectionReport(missingClient)).toContain(
      'built server/client/CSS artifact inspection is incomplete',
    );
  });
});

const componentSource = [
  "import { component } from '@kovojs/core';",
  'export const One = component({',
  '  render() { return <div>Hello</div>; },',
  '});',
  '',
].join('\n');

function temporaryRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-release-artifact-inspection-test-'));
  roots.push(root);
  return root;
}

function write(root, relative, source) {
  const file = path.join(root, ...relative.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source, { encoding: 'utf8', flag: 'wx' });
}

function authenticatedPackages() {
  return new Map(
    ['@kovojs/cli', '@kovojs/compiler', '@kovojs/core', '@kovojs/server'].map((name) => [
      name,
      { name, version: '0.3.0' },
    ]),
  );
}

function builtArtifactFixture() {
  const root = temporaryRoot();
  write(root, 'dist/server/server.mjs', 'export const server = true;\n');
  write(root, 'dist/server/server/handler.mjs', 'export const handler = true;\n');
  write(
    root,
    `dist/server/client/c/__v/${'1'.repeat(64)}/component.client.js`,
    'export const client = true;\n',
  );
  write(root, 'dist/server/client/assets/styles.css', ':root { --kovo-theme: proof; }\n');
  const frameworkPackages = [...authenticatedPackages().values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  write(
    root,
    'dist/.kovo/graph.json',
    `${JSON.stringify({
      components: [{}],
      diagnostics: [],
      mutations: [{}],
      pages: [{}],
      provenance: {
        frameworkPackages,
        graphSchemaVersion: 'kovo.graph/v2',
        pnpmLock: { contentHash: sha256 },
        schema: 'kovo.artifact.provenance/v1',
        securityGuarantees: {
          canonicalHash: sha256,
          schema: 'kovo.security.guarantees/v1',
        },
      },
      queries: [{}],
      verificationDiagnostics: [],
    })}\n`,
  );
  return root;
}

function diagnosticEnvelope(exitCode, diagnostics) {
  return {
    diagnostics,
    result: {
      command: 'check',
      exitCode,
      protocol: 'kovo-check/v1',
      text: `kovo-check/v1\n${exitCode === 0 ? 'OK' : 'ERROR KV235 lowered IR'}\n`,
    },
    version: 'kovo-diagnostic/v1',
  };
}

function successfulReport() {
  return {
    schema: RELEASE_ARTIFACT_INSPECTION_SCHEMA,
    pass: true,
    sourceCommit: '1'.repeat(40),
    packedManifest: { sha256 },
    packageSubject: sha256,
    sourceCensus: {
      schema: APP_COMPONENT_SOURCE_CENSUS_SCHEMA,
      components: [{}],
      findings: [],
      pass: true,
    },
    artifact: {
      schema: BUILT_ARTIFACT_INSPECTION_SCHEMA,
      clientModules: [{}],
      cssAssets: [{}],
      serverModules: [{}],
      pass: true,
    },
    runtime: {
      schema: RUNTIME_WIRE_INSPECTION_SCHEMA,
      css: { sha256 },
      document: { sha256 },
      mutationFrame: { sha256 },
      pass: true,
    },
    retained: [
      'check-green.json',
      'check-kv235.json',
      'document.redacted.html',
      'graph.json',
      'mutation-frame.redacted.html',
      'styles.css',
    ].map((evidencePath) => ({ bytes: 1, path: evidencePath, sha256 })),
  };
}
