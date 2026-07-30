import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const corePackageRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = resolve(corePackageRoot, '../..');
const vpBin = join(repoRoot, 'node_modules', '.bin', 'vp');

const auditedSideEffects = [
  './src/secret.ts',
  './src/internal/security-witness-intrinsics.ts',
  './src/internal/client-module-url.ts',
  './src/internal/client-module-url-intrinsics.ts',
  './src/internal/filesystem.ts',
  './src/internal/filesystem-intrinsics.ts',
  './src/internal/render-plan-token.ts',
  './src/internal/render-plan-token-intrinsics.ts',
  './dist/secret-*.mjs',
  './dist/internal/security-witness-intrinsics.mjs',
  './dist/internal/client-module-url.mjs',
  './dist/internal/client-module-url-intrinsics.mjs',
  './dist/internal/filesystem.mjs',
  './dist/internal/filesystem-intrinsics.mjs',
  './dist/internal/render-plan-token.mjs',
  './dist/internal/render-plan-token-intrinsics.mjs',
] as const;

const auditedPublishExtraEntries = [
  './src/internal/client-module-url-intrinsics.ts',
  './src/internal/filesystem-intrinsics.ts',
  './src/internal/render-plan-token-intrinsics.ts',
  './src/internal/security-witness-intrinsics.ts',
] as const;

// The root public surface is intentionally narrow, so its namespace bundle is no longer a useful
// relative yardstick. Keep the ordinary component path on a fixed reviewable source-unit budget
// while the structural assertions below continue to prove that storage and Node authority stay out.
const maxComponentBundleSourceUnits = 32 * 1024;

const componentConsumer = `
import { component } from '@kovojs/core';
const UsedComponent = component({ render() { return 'KOVO_USED_COMPONENT_INITIALIZER'; } });
globalThis.__kovoTreeShakeProbe = UsedComponent();
`;

const namespaceConsumer = `
import * as core from '@kovojs/core';
globalThis.__kovoTreeShakeAll = core;
`;

const storageNamespaceConsumer = `
import * as storage from '@kovojs/core/storage';
globalThis.__kovoTreeShakeStorage = storage;
`;

const bootstrapConsumer = `
import { clientModuleRepresentationDigest } from '@kovojs/core/internal/client-module-url';
import '@kovojs/core/internal/filesystem';
import '@kovojs/core/internal/render-plan-token';
globalThis.__kovoBootstrapProbe = 'KOVO_BOOTSTRAP_RETAINED';
`;

const guardConsumer = `
import { secret } from '@kovojs/core/security';
let outcome = 'OPEN';
try {
  structuredClone({ value: secret('victim-secret') });
} catch (error) {
  if (!String(error).includes('KV435')) throw error;
  outcome = 'CLOSED';
}
console.log('KOVO_STRUCTURED_CLONE_GUARD_' + outcome);
`;

const captureEffectivenessConsumer = `
import { clientModuleRepresentationDigest } from '@kovojs/core/internal/client-module-url';
import '@kovojs/core/internal/client-module-url';
import '@kovojs/core/internal/filesystem';
import '@kovojs/core/internal/render-plan-token';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

const clientSource = 'export const safe = true;';
const expectedClientDigest = clientModuleRepresentationDigest(clientSource);
const hashPrototype = Object.getPrototypeOf(createHash('sha256'));
const originalApply = Reflect.apply;
const originalByteLength = Buffer.byteLength;
const originalMapGet = Map.prototype.get;
const originalStartsWith = String.prototype.startsWith;
const originalUpdate = hashPrototype.update;
Reflect.apply = () => { throw new Error('late poisoned Reflect.apply'); };
Buffer.byteLength = () => 0;
Map.prototype.get = () => 'forged';
String.prototype.startsWith = () => false;
hashPrototype.update = function update() { return this; };
try {
  const [clientModule, fileSystem, renderPlan] = await Promise.all([
    import('@kovojs/core/internal/client-module-url'),
    import('@kovojs/core/internal/filesystem'),
    import('@kovojs/core/internal/render-plan-token'),
  ]);
  const firstRenderPlan = renderPlan.computeRenderPlanFingerprint({ account: 'field:id' });
  const secondRenderPlan = renderPlan.computeRenderPlanFingerprint({ account: 'field:role' });
  const capturesStayedEffective =
    clientModule.clientModuleRepresentationDigest(clientSource) === expectedClientDigest &&
    fileSystem.containsPath('/srv/kovo', '/srv/kovo/public/index.html') &&
    /^[0-9a-f]{64}$/.test(firstRenderPlan) &&
    firstRenderPlan !== secondRenderPlan;
  console.log('KOVO_BOOTSTRAP_CAPTURES_' + (capturesStayedEffective ? 'EFFECTIVE' : 'POISONED'));
} finally {
  hashPrototype.update = originalUpdate;
  String.prototype.startsWith = originalStartsWith;
  Map.prototype.get = originalMapGet;
  Buffer.byteLength = originalByteLength;
  Reflect.apply = originalApply;
}
`;

describe('core package selective side effects (SPEC §6.6)', () => {
  it('declares only the audited capture modules and emits stable dist entries for them', () => {
    const manifest = readCoreManifest();
    expect(manifest.sideEffects).toEqual(auditedSideEffects);
    expect(manifest.kovoPublish.extraEntries).toEqual(auditedPublishExtraEntries);
  });

  it('tree-shakes an ordinary source consumer while retaining used initialization and guards', () => {
    const componentBundle = bundleConsumer(corePackageRoot, componentConsumer, 'source-component');
    const namespaceBundle = bundleConsumer(corePackageRoot, namespaceConsumer, 'source-namespace');
    const storageNamespaceBundle = bundleConsumer(
      corePackageRoot,
      storageNamespaceConsumer,
      'source-storage-namespace',
    );

    expect(componentBundle.source).toContain('KOVO_USED_COMPONENT_INITIALIZER');
    expect(componentBundle.source).toContain('__kovoIsComponentDescriptor');
    expect(componentBundle.source).not.toContain('structuredClone input exceeds');
    expect(componentBundle.source).not.toContain('Kovo storage refused an unbounded byte stream.');
    expect(componentBundle.source).not.toContain('createS3CompatibleStorage');
    expect(componentBundle.source).not.toContain('node:fs');
    expect(componentBundle.source).not.toContain('node:buffer');
    expect(namespaceBundle.source).not.toContain('node:buffer');
    expect(namespaceBundle.source).not.toContain('Kovo storage refused an unbounded byte stream.');
    expect(namespaceBundle.source).not.toContain('createS3CompatibleStorage');
    expect(storageNamespaceBundle.source).toContain(
      'Kovo storage refused an unbounded byte stream.',
    );
    expect(storageNamespaceBundle.source).toContain('createS3CompatibleStorage');
    expect(componentBundle.source.length).toBeLessThan(maxComponentBundleSourceUnits);

    expectBootstrapCaptures(
      bundleConsumer(corePackageRoot, bootstrapConsumer, 'source-bootstrap').source,
    );
    expect(
      bundleConsumer(corePackageRoot, guardConsumer, 'source-guard', {
        executeMarker: 'KOVO_STRUCTURED_CLONE_GUARD_',
      }).stdout,
    ).toContain('KOVO_STRUCTURED_CLONE_GUARD_CLOSED');
    expect(
      executeSsrConsumer(corePackageRoot, captureEffectivenessConsumer, 'source-captures'),
    ).toContain('KOVO_BOOTSTRAP_CAPTURES_EFFECTIVE');
  }, 30_000);

  it('preserves the same selective contract after the package is built to dist', () => {
    const publishedRoot = buildPublishedCorePackage();
    try {
      const rootArtifacts = readdirSync(join(publishedRoot, 'dist'));
      expect(rootArtifacts.some((fileName) => /^secret-.+\.mjs$/u.test(fileName))).toBe(true);
      // Capture entries must not collapse back into shared hashed chunks: marking such a chunk as
      // side-effectful would pull Node-only filesystem setup into ordinary browser consumers.
      expect(rootArtifacts.some((fileName) => /^filesystem-.+\.mjs$/u.test(fileName))).toBe(false);
      expect(
        rootArtifacts.some((fileName) => /^security-witness-intrinsics-.+\.mjs$/u.test(fileName)),
      ).toBe(false);
      expect(readdirSync(join(publishedRoot, 'dist', 'internal'))).toEqual(
        expect.arrayContaining([
          'client-module-url-intrinsics.mjs',
          'filesystem-intrinsics.mjs',
          'render-plan-token-intrinsics.mjs',
          'security-witness-intrinsics.mjs',
        ]),
      );
      expect(readFileSync(join(publishedRoot, 'dist', 'index.mjs'), 'utf8')).toContain(
        './internal/security-witness-intrinsics.mjs',
      );
      expect(
        readFileSync(join(publishedRoot, 'dist', 'internal', 'filesystem.mjs'), 'utf8'),
      ).toContain('./security-witness-intrinsics.mjs');

      const componentBundle = bundleConsumer(
        publishedRoot,
        componentConsumer,
        'published-component',
      );
      const namespaceBundle = bundleConsumer(
        publishedRoot,
        namespaceConsumer,
        'published-namespace',
      );
      const storageNamespaceBundle = bundleConsumer(
        publishedRoot,
        storageNamespaceConsumer,
        'published-storage-namespace',
      );
      expect(componentBundle.source).toContain('KOVO_USED_COMPONENT_INITIALIZER');
      expect(componentBundle.source).not.toContain('structuredClone input exceeds');
      expect(componentBundle.source).not.toContain(
        'Kovo storage refused an unbounded byte stream.',
      );
      expect(componentBundle.source).not.toContain('createS3CompatibleStorage');
      expect(componentBundle.source).not.toContain('node:fs');
      expect(componentBundle.source).not.toContain('node:buffer');
      expect(namespaceBundle.source).not.toContain('node:buffer');
      expect(namespaceBundle.source).not.toContain(
        'Kovo storage refused an unbounded byte stream.',
      );
      expect(namespaceBundle.source).not.toContain('createS3CompatibleStorage');
      expect(storageNamespaceBundle.source).toContain(
        'Kovo storage refused an unbounded byte stream.',
      );
      expect(storageNamespaceBundle.source).toContain('createS3CompatibleStorage');
      expect(componentBundle.source.length).toBeLessThan(maxComponentBundleSourceUnits);

      expectBootstrapCaptures(
        bundleConsumer(publishedRoot, bootstrapConsumer, 'published-bootstrap').source,
      );
      expect(
        bundleConsumer(publishedRoot, guardConsumer, 'published-guard', {
          executeMarker: 'KOVO_STRUCTURED_CLONE_GUARD_',
        }).stdout,
      ).toContain('KOVO_STRUCTURED_CLONE_GUARD_CLOSED');
      expect(
        executeSsrConsumer(publishedRoot, captureEffectivenessConsumer, 'published-captures'),
      ).toContain('KOVO_BOOTSTRAP_CAPTURES_EFFECTIVE');
    } finally {
      rmSync(publishedRoot, { force: true, recursive: true });
    }
  }, 30_000);
});

interface CoreManifest {
  kovoPublish: { extraEntries: readonly string[] };
  sideEffects: readonly string[];
  version: string;
}

interface ConsumerBundle {
  source: string;
  stdout?: string;
}

function readCoreManifest(): CoreManifest {
  return JSON.parse(readFileSync(join(corePackageRoot, 'package.json'), 'utf8')) as CoreManifest;
}

function bundleConsumer(
  packageRoot: string,
  entrySource: string,
  label: string,
  options: { executeMarker?: string } = {},
): ConsumerBundle {
  const root = mkdtempSync(join(corePackageRoot, `.tmp-side-effects-${label}-`));
  try {
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'node_modules', '@kovojs'), { recursive: true });
    symlinkSync(packageRoot, join(root, 'node_modules', '@kovojs', 'core'), 'dir');
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    writeFileSync(
      join(root, 'vite.config.mjs'),
      'export default { build: { modulePreload: false } };\n',
    );
    writeFileSync(join(root, 'index.html'), '<script type="module" src="/src/main.ts"></script>');
    writeFileSync(join(root, 'src', 'main.ts'), entrySource);

    execFileSync(
      vpBin,
      ['build', root, '--outDir', 'dist', '--minify', 'false', '--logLevel', 'silent'],
      { cwd: repoRoot, stdio: 'pipe' },
    );

    const assetDirectory = join(root, 'dist', 'assets');
    const assets = readdirSync(assetDirectory)
      .filter((fileName) => fileName.endsWith('.js'))
      .sort()
      .map((fileName) => ({
        fileName,
        source: readFileSync(join(assetDirectory, fileName), 'utf8'),
      }));
    if (assets.length === 0) throw new Error(`Vite emitted no JavaScript for ${label}.`);

    const source = assets.map((asset) => asset.source).join('\n');
    const executeMarker = options.executeMarker;
    if (executeMarker === undefined) return { source };
    const entry = assets.find((asset) => asset.source.includes(executeMarker));
    if (entry === undefined) throw new Error(`Vite omitted the execution marker for ${label}.`);
    const stdout = execFileSync(process.execPath, [join(assetDirectory, entry.fileName)], {
      encoding: 'utf8',
    });
    return { source, stdout };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function buildPublishedCorePackage(): string {
  const root = mkdtempSync(join(corePackageRoot, '.tmp-side-effects-published-'));
  try {
    execFileSync(
      vpBin,
      [
        'pack',
        'src/index.ts',
        'src/security.ts',
        'src/storage-public.ts',
        'src/internal/wire-json.ts',
        'src/internal/storage.ts',
        'src/internal/client-module-url.ts',
        'src/internal/client-module-url-intrinsics.ts',
        'src/internal/filesystem.ts',
        'src/internal/filesystem-intrinsics.ts',
        'src/internal/render-plan-token.ts',
        'src/internal/render-plan-token-intrinsics.ts',
        'src/internal/security-witness-intrinsics.ts',
        'src/internal/sink-policy.ts',
        '--no-config',
        '-d',
        join(root, 'dist'),
        '--no-dts',
        '--logLevel',
        'silent',
      ],
      { cwd: corePackageRoot, stdio: 'pipe' },
    );
    const manifest = readCoreManifest();
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify(
        {
          exports: {
            '.': './dist/index.mjs',
            './security': './dist/security.mjs',
            './storage': './dist/storage-public.mjs',
            './internal/client-module-url': './dist/internal/client-module-url.mjs',
            './internal/filesystem': './dist/internal/filesystem.mjs',
            './internal/render-plan-token': './dist/internal/render-plan-token.mjs',
          },
          name: '@kovojs/core',
          sideEffects: manifest.sideEffects,
          type: 'module',
          version: manifest.version,
        },
        null,
        2,
      )}\n`,
    );
    return root;
  } catch (error) {
    rmSync(root, { force: true, recursive: true });
    throw error;
  }
}

function executeSsrConsumer(packageRoot: string, entrySource: string, label: string): string {
  const root = mkdtempSync(join(corePackageRoot, `.tmp-side-effects-${label}-`));
  try {
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'node_modules', '@kovojs'), { recursive: true });
    symlinkSync(packageRoot, join(root, 'node_modules', '@kovojs', 'core'), 'dir');
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    writeFileSync(
      join(root, 'vite.config.mjs'),
      `export default {
  build: {
    minify: false,
    rollupOptions: { output: { entryFileNames: 'entry.mjs' } },
    ssr: 'src/main.ts',
  },
  ssr: { noExternal: ['@kovojs/core'] },
};
`,
    );
    writeFileSync(join(root, 'src', 'main.ts'), entrySource);

    execFileSync(vpBin, ['build', root, '--outDir', 'dist', '--logLevel', 'silent'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    return execFileSync(process.execPath, [join(root, 'dist', 'entry.mjs')], {
      encoding: 'utf8',
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function expectBootstrapCaptures(source: string): void {
  expect(source).toContain('https://attacker.invalid');
  expect(source).toContain('kovo-filesystem-control');
  expect(source).toContain('Kovo-storage');
  expect(source).toContain('Kovo render-plan hash controls are unavailable.');
  expect(source).toContain('KOVO_BOOTSTRAP_RETAINED');
}
