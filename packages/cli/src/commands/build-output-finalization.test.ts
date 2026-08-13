import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type * as CoreGraph from '@kovojs/core/internal/graph';
import type { KovoNeutralBuild } from '@kovojs/server/internal/build';
import type { KovoBuildPreset, KovoBuildPresetContext } from '@kovojs/server/internal/build-preset';

import type { KovoBuildOneShotIdentity } from './build-one-shot-handoff.js';
import {
  assertKovoNeutralBuildSealForTesting,
  createKovoNeutralBuildSealForTesting,
  defaultKovoBuildPresetForTesting,
  inspectFinalizedKovoBuildPresetForTesting,
  requireKovoBuildOneShotNeutralBuildForTesting,
  type KovoBuildOutputTransaction,
} from './build-export.js';

const pendingHandler = "throw new Error('Kovo build server handler was not finalized.');\n";
const finalizedHandler = 'export default async function handler() { return new Response(); }\n';

describe('one-shot build output finalization (SPEC §5.2 rule 9)', () => {
  it('rejects the sentinel and rechecks handler, graph, provenance, identity, and tree bytes', () => {
    const fixture = neutralFixture();
    try {
      expect(() =>
        createKovoNeutralBuildSealForTesting(
          fixture.neutralBuild,
          fixture.graph,
          fixture.provenance,
          fixture.identity,
        ),
      ).toThrow('pending server handler sentinel');

      writeFileSync(fixture.neutralBuild.serverHandlerPath!, finalizedHandler, 'utf8');
      const seal = createKovoNeutralBuildSealForTesting(
        fixture.neutralBuild,
        fixture.graph,
        fixture.provenance,
        fixture.identity,
      );
      expect(seal).toMatchObject({
        artifactProvenanceDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        checkGraphDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        graphArtifactDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        handlerDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        neutralTreeDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        schema: 'kovo-neutral-build-seal/v1',
      });
      expect(() =>
        assertKovoNeutralBuildSealForTesting(
          fixture.neutralBuild,
          fixture.graph,
          fixture.provenance,
          fixture.identity,
          seal,
        ),
      ).not.toThrow();

      writeFileSync(fixture.neutralBuild.serverHandlerPath!, pendingHandler, 'utf8');
      expect(() =>
        assertKovoNeutralBuildSealForTesting(
          fixture.neutralBuild,
          fixture.graph,
          fixture.provenance,
          fixture.identity,
          seal,
        ),
      ).toThrow('pending server handler sentinel');
      writeFileSync(fixture.neutralBuild.serverHandlerPath!, finalizedHandler, 'utf8');

      for (const consumedFile of [
        join(fixture.neutralBuild.publicAssetDir!, 'robots.txt'),
        join(fixture.neutralBuild.rootedFileRoots![0]!.root, 'catalog.json'),
        join(fixture.neutralBuild.staticOutput!.dir, 'index.html'),
      ]) {
        const original = readFileSync(consumedFile, 'utf8');
        writeFileSync(consumedFile, `${original}tampered`, 'utf8');
        expect(() =>
          assertKovoNeutralBuildSealForTesting(
            fixture.neutralBuild,
            fixture.graph,
            fixture.provenance,
            fixture.identity,
            seal,
          ),
        ).toThrow('integrity seal is stale');
        writeFileSync(consumedFile, original, 'utf8');
      }

      writeFileSync(fixture.graphPath, '{"routes":["tampered"]}\n', 'utf8');
      expect(() =>
        assertKovoNeutralBuildSealForTesting(
          fixture.neutralBuild,
          fixture.graph,
          fixture.provenance,
          fixture.identity,
          seal,
        ),
      ).toThrow('differs from the completed check graph');
      writeFileSync(fixture.graphPath, `${JSON.stringify(fixture.graph, null, 2)}\n`, 'utf8');

      const injectedArtifact = join(fixture.neutralBuild.outDir, 'injected.txt');
      writeFileSync(injectedArtifact, 'not in the finalized tree', 'utf8');
      expect(() =>
        assertKovoNeutralBuildSealForTesting(
          fixture.neutralBuild,
          fixture.graph,
          fixture.provenance,
          fixture.identity,
          seal,
        ),
      ).toThrow('integrity seal is stale');
      unlinkSync(injectedArtifact);

      expect(() =>
        assertKovoNeutralBuildSealForTesting(
          fixture.neutralBuild,
          fixture.graph,
          { ...fixture.provenance, version: 'tampered' },
          fixture.identity,
          seal,
        ),
      ).toThrow('integrity seal is stale');
      expect(() =>
        assertKovoNeutralBuildSealForTesting(
          fixture.neutralBuild,
          fixture.graph,
          fixture.provenance,
          { ...fixture.identity, optionsDigest: `sha256:${'f'.repeat(64)}` },
          seal,
        ),
      ).toThrow('integrity seal is stale');
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it('presents only the finalized neutral build to configured preset inspection', async () => {
    const fixture = neutralFixture(finalizedHandler);
    try {
      const seal = createKovoNeutralBuildSealForTesting(
        fixture.neutralBuild,
        fixture.graph,
        fixture.provenance,
        fixture.identity,
      );
      let observedHandler = '';
      const observingPreset: KovoBuildPreset = {
        emit() {},
        inspect(build) {
          observedHandler = readFileSync(build.serverHandlerPath!, 'utf8');
          return [];
        },
        name: 'node',
      };
      await expect(
        inspectFinalizedKovoBuildPresetForTesting(
          observingPreset,
          fixture.neutralBuild,
          fixture.context,
          fixture.graph,
          fixture.provenance,
          fixture.identity,
          seal,
        ),
      ).resolves.toEqual([]);
      expect(observedHandler).toBe(finalizedHandler);
      expect(observedHandler).not.toBe(pendingHandler);

      const mutatingPreset: KovoBuildPreset = {
        emit() {},
        inspect(build) {
          writeFileSync(build.serverHandlerPath!, 'export const stale = true;\n', 'utf8');
          return [];
        },
        name: 'node',
      };
      await expect(
        inspectFinalizedKovoBuildPresetForTesting(
          mutatingPreset,
          fixture.neutralBuild,
          fixture.context,
          fixture.graph,
          fixture.provenance,
          fixture.identity,
          seal,
        ),
      ).rejects.toThrow('integrity seal is stale');
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it('resolves each source built-in token through the same private WeakMap witness', async () => {
    for (const name of ['node', 'vercel', 'cloudflare'] as const) {
      await expect(defaultKovoBuildPresetForTesting(name)).resolves.toMatchObject({ name });
    }
  });

  it('accepts only canonical transaction-owned optional neutral paths in the handoff', () => {
    const fixture = neutralFixture(finalizedHandler);
    const transaction: KovoBuildOutputTransaction = {
      buildId: '.kovo-build-stage-test',
      finalOutDir: join(fixture.root, '..', 'dist'),
      promoted: false,
      sealed: false,
      stagedOutDir: fixture.root,
    };
    try {
      expect(requireKovoBuildOneShotNeutralBuildForTesting(fixture.neutralBuild, transaction)).toBe(
        fixture.neutralBuild,
      );
      expect(() =>
        requireKovoBuildOneShotNeutralBuildForTesting(
          { ...fixture.neutralBuild, publicAssetDir: join(fixture.root, 'ambient-public') },
          transaction,
        ),
      ).toThrow('invalid publicAssetDir');
      expect(() =>
        requireKovoBuildOneShotNeutralBuildForTesting(
          {
            ...fixture.neutralBuild,
            rootedFileRoots: [{ root: join(fixture.root, 'ambient-catalog'), spec: '../catalog' }],
          },
          transaction,
        ),
      ).toThrow('invalid rootedFileRoots');
      expect(() =>
        requireKovoBuildOneShotNeutralBuildForTesting(
          {
            ...fixture.neutralBuild,
            rootedFileRoots: [
              { root: fixture.neutralBuild.rootedFileRoots![0]!.root, spec: '/srv/catalog' },
            ],
          },
          transaction,
        ),
      ).toThrow('invalid rootedFileRoots');
      expect(() =>
        requireKovoBuildOneShotNeutralBuildForTesting(
          {
            ...fixture.neutralBuild,
            staticOutput: {
              ...fixture.neutralBuild.staticOutput!,
              dir: join(fixture.root, 'ambient-static'),
            },
          },
          transaction,
        ),
      ).toThrow('invalid staticOutput');
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });
});

function neutralFixture(handlerSource: string = pendingHandler): {
  readonly context: KovoBuildPresetContext;
  readonly graph: CoreGraph.KovoCheckInput;
  readonly graphPath: string;
  readonly identity: KovoBuildOneShotIdentity;
  readonly neutralBuild: KovoNeutralBuild;
  readonly provenance: { readonly package: string; readonly version: string };
  readonly root: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'kovo-neutral-finalization-'));
  const outDir = join(root, '.kovo');
  const clientDir = join(outDir, 'client');
  const serverDir = join(outDir, 'server');
  const publicAssetDir = join(outDir, 'public');
  const rootedFileRoot = join(outDir, 'rooted', `root-${encodeURIComponent('../catalog')}`);
  const staticDir = join(outDir, 'static');
  mkdirSync(clientDir, { recursive: true });
  mkdirSync(serverDir, { recursive: true });
  mkdirSync(publicAssetDir, { recursive: true });
  mkdirSync(rootedFileRoot, { recursive: true });
  mkdirSync(staticDir, { recursive: true });
  const graph = { routes: [] } as unknown as CoreGraph.KovoCheckInput;
  const graphPath = join(outDir, 'graph.json');
  const serverHandlerPath = join(serverDir, 'handler.mjs');
  writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  writeFileSync(serverHandlerPath, handlerSource, 'utf8');
  writeFileSync(join(publicAssetDir, 'robots.txt'), 'User-agent: *\n', 'utf8');
  writeFileSync(join(rootedFileRoot, 'catalog.json'), '{}\n', 'utf8');
  writeFileSync(join(staticDir, 'index.html'), '<main>static</main>\n', 'utf8');
  writeFileSync(join(staticDir, 'kovo-static-manifest.json'), '{}\n', 'utf8');
  const neutralBuild: KovoNeutralBuild = {
    clientDir,
    clientModules: [],
    manifestPath: join(outDir, 'manifest.json'),
    metaPath: join(outDir, 'meta.json'),
    outDir,
    publicAssetDir,
    routeHints: [],
    rootedFileRoots: [{ root: rootedFileRoot, spec: '../catalog' }],
    routesPath: join(outDir, 'routes.json'),
    serverDir,
    serverHandlerPath,
    staticAssets: [],
    staticOutput: {
      complete: true,
      diagnostics: [],
      dir: staticDir,
      manifestPath: join(staticDir, 'kovo-static-manifest.json'),
      routeDocuments: [{ path: '/', routePath: '/' }],
    },
    staticOnly: false,
    tasks: [],
    version: 'kovo-neutral-build/v1',
  };
  const identity: KovoBuildOneShotIdentity = {
    appModulePath: 'src/app.tsx',
    compilerProvenanceDigest: `sha256:${'a'.repeat(64)}`,
    configSourceDigest: null,
    invocationRoot: root,
    optionsDigest: `sha256:${'b'.repeat(64)}`,
    sourceSetDigest: `sha256:${'c'.repeat(64)}`,
  };
  const provenance = { package: '@kovojs/compiler', version: 'test' };
  const context: KovoBuildPresetContext = {
    declaredEnv: [],
    log() {},
    outDir: join(root, 'server'),
    projectRoot: root,
    readNeutral() {
      return neutralBuild;
    },
    readServerHandlerSource() {
      return readFileSync(serverHandlerPath, 'utf8');
    },
  };
  return { context, graph, graphPath, identity, neutralBuild, provenance, root };
}
