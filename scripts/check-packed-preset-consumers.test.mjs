import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertInstalledPackedSubject,
  assertPackedPresetBuild,
  assertPackedPresetConfig,
  packedPresetConfig,
  packedPresetConsumerEnvironment,
  parsePackedPresetConsumerArgs,
} from './check-packed-preset-consumers.mjs';

const roots = [];
const digest = 'a'.repeat(64);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('packed deployment-preset consumers', () => {
  it('accepts only an explicit packed manifest argument', () => {
    expect(parsePackedPresetConsumerArgs([]).packedManifest).toMatch(
      /\/\.release\/packed-packages\.json$/u,
    );
    expect(
      parsePackedPresetConsumerArgs(['--packed-manifest', '/tmp/release/.release/packed.json']),
    ).toEqual({
      packedManifest: '/tmp/release/.release/packed.json',
    });
    expect(() => parsePackedPresetConsumerArgs(['--unknown'])).toThrow('Unknown');
    expect(() => parsePackedPresetConsumerArgs(['--packed-manifest'])).toThrow('requires a value');
  });

  it('renders the exact SPEC section 14 retention assertion for every supported preset', () => {
    for (const preset of ['node', 'vercel', 'cloudflare']) {
      const source = packedPresetConfig(preset);
      expect(source).toContain(`defineConfig, ${preset}`);
      expect(source).toContain(`preset: ${preset}({`);
      expect(source).toContain('hours: 24');
      expect(source).toContain("immutableClientModules: 'retained'");
      expect(source).toContain("priorTokenQueryReads: 'retained'");
      expect(() => assertPackedPresetConfig(source, preset)).not.toThrow();
    }
    expect(() => packedPresetConfig('static')).toThrow('Unsupported packed deployment preset');
    expect(() => assertPackedPresetConfig(packedPresetConfig('vercel'), 'node')).toThrow(
      'exact node',
    );
  });

  it('removes ambient host selection without dropping inherited security controls', () => {
    const environment = packedPresetConsumerEnvironment({
      CF_PAGES: '1',
      CLOUDFLARE: '1',
      KOVO_EGRESS_MODE: 'deny',
      KOVO_PRESET: 'vercel',
      NODE_OPTIONS: '--require=/tmp/reviewed-egress-hook.cjs',
      VERCEL: '1',
    });
    expect(environment).toMatchObject({
      CI: '1',
      KOVO_EGRESS_MODE: 'deny',
      LANG: 'C',
      LC_ALL: 'C',
      NODE_OPTIONS: '--require=/tmp/reviewed-egress-hook.cjs',
      SOURCE_DATE_EPOCH: expect.any(String),
      TZ: 'UTC',
    });
    for (const removed of ['CF_PAGES', 'CLOUDFLARE', 'KOVO_PRESET', 'VERCEL']) {
      expect(environment).not.toHaveProperty(removed);
    }
  });

  it('binds installed package files byte-for-byte to the authenticated tar subject', () => {
    const appRoot = fixtureRoot('kovo-packed-installed-subject-');
    const packageRoot = path.join(appRoot, 'node_modules', '@kovojs', 'core');
    mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    const manifest = '{"name":"@kovojs/core","version":"0.3.0"}\n';
    const runtime = 'export const packed = true;\n';
    writeFileSync(path.join(packageRoot, 'package.json'), manifest);
    writeFileSync(path.join(packageRoot, 'dist', 'index.mjs'), runtime);
    const pkg = {
      entries: [
        { data: Buffer.from(runtime), name: 'package/dist/index.mjs' },
        { data: Buffer.from(manifest), name: 'package/package.json' },
      ],
      name: '@kovojs/core',
    };

    expect(() => assertInstalledPackedSubject(appRoot, pkg)).not.toThrow();
    const virtualAppRoot = fixtureRoot('kovo-packed-virtual-subject-');
    const virtualPackageRoot = path.join(
      virtualAppRoot,
      'node_modules',
      '.pnpm',
      '@kovojs+core@file+packed-core',
      'node_modules',
      '@kovojs',
      'core',
    );
    mkdirSync(path.join(virtualPackageRoot, 'dist'), { recursive: true });
    mkdirSync(path.join(virtualPackageRoot, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(path.join(virtualPackageRoot, 'package.json'), manifest);
    writeFileSync(path.join(virtualPackageRoot, 'dist', 'index.mjs'), runtime);
    writeFileSync(
      path.join(virtualPackageRoot, 'node_modules', '.bin', 'package-bin'),
      '#!/bin/sh\n',
    );
    expect(() => assertInstalledPackedSubject(virtualAppRoot, pkg)).not.toThrow();

    writeFileSync(path.join(packageRoot, 'dist', 'index.mjs'), 'export const tampered = true;\n');
    expect(() => assertInstalledPackedSubject(appRoot, pkg)).toThrow(
      'differs from its authenticated tarball subject',
    );
    writeFileSync(path.join(packageRoot, 'dist', 'index.mjs'), runtime);
    writeFileSync(path.join(packageRoot, 'extra.mjs'), 'export {};\n');
    expect(() => assertInstalledPackedSubject(appRoot, pkg)).toThrow(
      'differs from its authenticated tarball subject',
    );
  });

  it('accepts complete Node, Vercel, and Cloudflare production artifacts', () => {
    const packedPackages = authenticatedPackages();
    for (const preset of ['node', 'vercel', 'cloudflare']) {
      const outDir = buildFixture(preset);
      expect(() =>
        assertPackedPresetBuild({
          outDir,
          packedPackages,
          preset,
          stdout: successOutput(preset, outDir),
        }),
      ).not.toThrow();
    }
  });

  it('fails closed on wrong preset selection or retained foreign output', () => {
    const packedPackages = authenticatedPackages();
    const wrongSummary = buildFixture('vercel');
    expect(() =>
      assertPackedPresetBuild({
        outDir: wrongSummary,
        packedPackages,
        preset: 'vercel',
        stdout: successOutput('cloudflare', wrongSummary),
      }),
    ).toThrow('wrong or malformed preset summary');

    const wrongProof = buildFixture('cloudflare');
    const graphPath = path.join(wrongProof, '.kovo', 'graph.json');
    const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
    graph.proof.postureProfile = 'node';
    writeJson(graphPath, graph);
    expect(() =>
      assertPackedPresetBuild({
        outDir: wrongProof,
        packedPackages,
        preset: 'cloudflare',
        stdout: successOutput('cloudflare', wrongProof),
      }),
    ).toThrow('exact complete build proof');

    const foreign = buildFixture('node');
    mkdirSync(path.join(foreign, '.vercel', 'output'), { recursive: true });
    writeFileSync(path.join(foreign, '.vercel', 'output', 'foreign.txt'), 'foreign\n');
    expect(() =>
      assertPackedPresetBuild({
        outDir: foreign,
        packedPackages,
        preset: 'node',
        stdout: successOutput('node', foreign),
      }),
    ).toThrow('different preset');
  });

  it('fails closed on missing, malformed, tampered, and development-only output', () => {
    const packedPackages = authenticatedPackages();
    const tampered = buildFixture('node');
    writeFileSync(path.join(tampered, 'server', 'server.mjs'), 'export const tampered = true;\n');
    expect(() =>
      assertPackedPresetBuild({
        outDir: tampered,
        packedPackages,
        preset: 'node',
        stdout: successOutput('node', tampered),
      }),
    ).toThrow('digest does not match');

    const missing = buildFixture('cloudflare');
    rmSync(path.join(missing, 'cloudflare', 'worker.mjs'));
    expect(() =>
      assertPackedPresetBuild({
        outDir: missing,
        packedPackages,
        preset: 'cloudflare',
        stdout: successOutput('cloudflare', missing),
      }),
    ).toThrow();

    const malformed = buildFixture('vercel');
    writeJson(path.join(malformed, '.vercel', 'output', 'config.json'), {
      routes: [],
      version: 2,
    });
    expect(() =>
      assertPackedPresetBuild({
        outDir: malformed,
        packedPackages,
        preset: 'vercel',
        stdout: successOutput('vercel', malformed),
      }),
    ).toThrow('Build Output API v3');

    const development = buildFixture('cloudflare');
    writeFileSync(
      path.join(development, 'cloudflare', 'client', 'development.js'),
      'import "/@vite/client";\n',
    );
    expect(() =>
      assertPackedPresetBuild({
        outDir: development,
        packedPackages,
        preset: 'cloudflare',
        stdout: successOutput('cloudflare', development),
      }),
    ).toThrow('Vite development client');
  });

  it('rejects build provenance that is absent from the authenticated package set', () => {
    const packedPackages = authenticatedPackages();
    const outDir = buildFixture('node');
    const graphPath = path.join(outDir, '.kovo', 'graph.json');
    const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
    graph.provenance.frameworkPackages[0].version = '9.9.9';
    writeJson(graphPath, graph);
    expect(() =>
      assertPackedPresetBuild({
        outDir,
        packedPackages,
        preset: 'node',
        stdout: successOutput('node', outDir),
      }),
    ).toThrow('is not authenticated');
  });
});

function authenticatedPackages() {
  return new Map(
    ['@kovojs/cli', '@kovojs/compiler', '@kovojs/core', '@kovojs/server'].map((name) => [
      name,
      { name, version: '0.3.0' },
    ]),
  );
}

function fixtureRoot(prefix) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function buildFixture(preset) {
  const root = fixtureRoot(`kovo-packed-${preset}-fixture-`);
  writeNeutralProof(root, preset);
  if (preset === 'node') writeNodeOutput(root);
  if (preset === 'vercel') writeVercelOutput(root);
  if (preset === 'cloudflare') writeCloudflareOutput(root);
  return root;
}

function writeNeutralProof(root, preset) {
  const neutral = path.join(root, '.kovo');
  mkdirSync(path.join(neutral, 'server'), { recursive: true });
  writeJson(path.join(neutral, 'meta.json'), {
    hasServerHandler: true,
    version: 'kovo-neutral-build/v1',
  });
  writeJson(path.join(neutral, 'manifest.json'), {
    version: 'kovo-neutral-build/v1',
  });
  writeJson(path.join(neutral, 'graph.json'), {
    proof: {
      appBuildToken: `sha256:${digest}`,
      appId: 'b6bf05a2-beb1-4cb5-bd68-a1edc65ec539',
      compilerVersion: '0.3.0',
      completion: 'complete',
      configDigest: `sha256:${digest}`,
      postureProfile: preset,
      schema: 'kovo.graph.proof/v2',
      sourceSetDigest: `sha256:${digest}`,
    },
    provenance: {
      frameworkPackages: [
        { name: '@kovojs/cli', version: '0.3.0' },
        { name: '@kovojs/compiler', version: '0.3.0' },
        { name: '@kovojs/core', version: '0.3.0' },
        { name: '@kovojs/server', version: '0.3.0' },
      ],
      schema: 'kovo.artifact.provenance/v1',
    },
  });
  writeFileSync(
    path.join(neutral, 'server', 'handler.mjs'),
    'export default () => new Response("OK");\n',
  );
}

function writeNodeOutput(root) {
  const output = path.join(root, 'server');
  mkdirSync(path.join(output, 'server'), { recursive: true });
  writeFileSync(path.join(output, 'server.mjs'), 'export const server = true;\n');
  writeFileSync(path.join(output, 'node-adapter.mjs'), 'export const adapter = true;\n');
  writeFileSync(
    path.join(output, 'server', 'handler.mjs'),
    'export default () => new Response("OK");\n',
  );
  writeFileSync(
    path.join(output, 'Dockerfile'),
    [
      'FROM node:24-alpine@sha256:reviewed',
      'ENV NODE_ENV=production',
      'USER node',
      'RUN npm ci --omit=dev --ignore-scripts',
      'CMD ["node", "server.mjs"]',
      '',
    ].join('\n'),
  );
  writeJson(path.join(output, 'package.json'), {
    dependencies: { '@kovojs/server': '0.3.0' },
    devDependencies: { vitest: '4.1.10' },
    scripts: { start: 'NODE_ENV=production node server.mjs' },
    type: 'module',
  });
  writeIntegrity(output, ['node-adapter.mjs', 'server.mjs']);
}

function writeVercelOutput(root) {
  const output = path.join(root, '.vercel', 'output');
  const functionRoot = path.join(output, 'functions', 'kovo.func');
  const ingressRoot = path.join(output, 'functions', 'kovo-ingress.func');
  mkdirSync(functionRoot, { recursive: true });
  mkdirSync(ingressRoot, { recursive: true });
  writeJson(path.join(output, 'config.json'), {
    routes: [
      {
        headers: {
          'cache-control': 'public, max-age=31536000, immutable',
          'cross-origin-resource-policy': 'same-origin',
          'x-content-type-options': 'nosniff',
        },
        src: '/c/(.*)',
      },
      {
        headers: {
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
        },
        src: '/(.*)',
      },
      { handle: 'filesystem' },
      { dest: '/kovo', src: '/(.*)' },
    ],
    version: 3,
  });
  writeJson(path.join(functionRoot, '.vc-config.json'), {
    handler: 'index.cjs',
    launcherType: 'Nodejs',
    runtime: 'nodejs22.x',
    shouldAddHelpers: true,
  });
  writeFileSync(path.join(functionRoot, 'index.cjs'), 'module.exports = {};\n');
  writeFileSync(path.join(functionRoot, 'node-adapter.mjs'), 'export const adapter = true;\n');
  writeFileSync(
    path.join(functionRoot, 'handler.mjs'),
    'export default () => new Response("OK");\n',
  );
  writeIntegrity(functionRoot, ['index.cjs', 'node-adapter.mjs']);
  writeJson(path.join(ingressRoot, '.vc-config.json'), {
    entrypoint: 'index.js',
    runtime: 'edge',
  });
  writeFileSync(path.join(ingressRoot, 'index.js'), 'export default {};\n');
  writeIntegrity(ingressRoot, ['index.js']);
}

function writeCloudflareOutput(root) {
  const output = path.join(root, 'cloudflare');
  mkdirSync(path.join(output, 'client'), { recursive: true });
  mkdirSync(path.join(output, 'server'), { recursive: true });
  writeFileSync(
    path.join(output, 'worker.mjs'),
    "const handler = await import('./server/handler.mjs');\nexport default handler;\n",
  );
  writeFileSync(
    path.join(output, 'server', 'handler.mjs'),
    'export default () => new Response("OK");\n',
  );
  writeFileSync(path.join(output, 'client', 'app.js'), 'export const client = true;\n');
  writeFileSync(
    path.join(output, 'wrangler.toml'),
    [
      'main = "./worker.mjs"',
      'compatibility_flags = ["nodejs_compat"]',
      '[assets]',
      'directory = "./client"',
      'binding = "ASSETS"',
      'run_worker_first = true',
      '',
    ].join('\n'),
  );
  writeIntegrity(output, ['worker.mjs']);
}

function successOutput(preset, outDir) {
  const serverOutDir =
    preset === 'node'
      ? path.join(outDir, 'server')
      : preset === 'vercel'
        ? path.join(outDir, '.vercel', 'output')
        : path.join(outDir, 'cloudflare');
  return [
    'kovo-build/v1',
    `SUMMARY preset=${preset} outDir=${JSON.stringify(outDir)} serverOutDir=${JSON.stringify(serverOutDir)}`,
    '',
  ].join('\n');
}

function writeIntegrity(root, relativeFiles) {
  writeJson(path.join(root, 'kovo-artifact-integrity.json'), {
    algorithm: 'sha256',
    files: Object.fromEntries(
      relativeFiles.map((relative) => [
        relative,
        createHash('sha256')
          .update(readFileSync(path.join(root, relative)))
          .digest('hex'),
      ]),
    ),
  });
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
