import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { enhancedNavigationDocumentAcceptHeader } from '@kovojs/core/internal/document-protocol';

import {
  assertInlineKovoLoaderModuleArtifactParity,
  assertInlineKovoLoaderBootstrapGzipBudget,
  buildInlineKovoLoaderModuleSource,
  buildInlineKovoLoaderInstallerReadableSource,
  buildInlineKovoLoaderInstallerSource,
  buildInlineKovoLoaderStubInstallerSource,
  emitInlineKovoLoaderModule,
  inlineDelegatedEvents,
  inlineFragmentTargetEscapeReadableSource,
  inlineKovoLoaderGzipByteBudget,
  inlineKovoLoaderInstallerReadableSource,
  inlineKovoLoaderStubInstallerReadableSource,
} from './inline-loader-build.js';
import { escapeCssString } from './fragment-targets.js';
import {
  createInlineKovoLoaderSource,
  inlineKovoLoaderBootstrapInstallerSource,
  inlineKovoLoaderInstallerSource,
  kovoDeferredRuntimeModulePath,
  kovoDeferredRuntimeModuleSource,
} from './inline-loader.js';
import { defaultDelegatedEvents } from './loader.js';

function createOversizedInlineLoaderSource(): string {
  let state = 0x12345678;
  const payload = Array.from({ length: 2200 }, () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return `'${state.toString(36).padStart(7, '0')}'`;
  }).join(',');

  return [
    'function installInlineKovoLoader(importModule) {',
    `  const payload = [${payload}];`,
    '  return payload.length + Boolean(importModule);',
    '}',
  ].join('\n');
}

describe('inline loader build source', () => {
  it('pins the shipped minified installer to the deterministic source helper', () => {
    // SPEC.md §4.4: drift checks must compare the shipped bootstrap to readable source.
    expect(inlineKovoLoaderInstallerReadableSource).toBe(
      buildInlineKovoLoaderInstallerReadableSource(),
    );
    expect(inlineKovoLoaderInstallerReadableSource).toContain('\nfunction installInlineKovoLoader');
    expect(inlineKovoLoaderInstallerReadableSource).toContain("join('; ')");
    expect(inlineKovoLoaderInstallerReadableSource).toContain(
      "bns.createMutationBroadcastChannel('kovo:mutation-response')",
    );
    expect(inlineKovoLoaderInstallerReadableSource).not.toContain('new BroadcastChannel(');
    expect(inlineKovoLoaderInstallerReadableSource).toContain("listen('visibilitychange'");
    expect(buildInlineKovoLoaderInstallerSource()).toBe(inlineKovoLoaderInstallerSource);
    expect(inlineKovoLoaderInstallerSource).toContain("'kovo-live-component'");
    expect(inlineKovoLoaderInstallerSource).not.toContain('kovo-live-cp');
  });

  it('emits the checked-in runtime module from the readable inline loader source', () => {
    // SPEC.md §4.4: build-time emission must keep the shipped bootstrap tied to readable source.
    const moduleSource = buildInlineKovoLoaderModuleSource();

    expect(() => assertInlineKovoLoaderModuleArtifactParity(moduleSource)).not.toThrow();
    expect(moduleSource).toBe(readFileSync(new URL('./inline-loader.ts', import.meta.url), 'utf8'));
    expect(moduleSource).toContain('const inlineKovoLoaderInstaller = (');
    expect(moduleSource).toContain('inlineKovoLoaderInstaller(importModule);');
    expect(moduleSource).toContain('const inlineKovoLoaderBootstrapInstaller = (');
    expect(moduleSource).toContain('installInlineKovoBootstrap(');
    expect(moduleSource).toContain('kovoDeferredRuntimeModuleSource');
    expect(kovoDeferredRuntimeModuleSource).toContain('installKovoDeferredRuntime');
    expect(kovoDeferredRuntimeModuleSource).toContain(inlineKovoLoaderInstallerSource);
    expect(kovoDeferredRuntimeModuleSource).toContain('BroadcastChannel');
    expect(kovoDeferredRuntimeModuleSource).toContain('visibilitychange');
    expect(inlineKovoLoaderBootstrapInstallerSource).toBe(
      buildInlineKovoLoaderStubInstallerSource(),
    );
    expect(moduleSource).toContain('importModule: ImportHandlerModule,');
    expect(moduleSource).not.toContain('InlineImportHandlerModule');
    expect(moduleSource).not.toContain('eval');
  });

  it('generates the inline delegated event list from the modular loader source', () => {
    // SPEC.md §4.4: the modular and inline loaders delegate the same event set.
    expect(inlineDelegatedEvents).toEqual([...defaultDelegatedEvents]);
    expect(inlineKovoLoaderInstallerReadableSource).toContain(
      `const events = ${JSON.stringify([...defaultDelegatedEvents])};`,
    );
    expect(inlineKovoLoaderStubInstallerReadableSource).toContain(
      "const events = ['click', 'submit'];",
    );
  });

  it('generates inline fragment-target escaping from the modular helper', () => {
    // SPEC.md §9.1: inline and modular fragment-target lookup must escape selectors identically.
    expect(inlineFragmentTargetEscapeReadableSource).toContain('function escapeCssString(value)');
    expect(inlineKovoLoaderInstallerReadableSource).toContain(
      inlineFragmentTargetEscapeReadableSource,
    );
    expect(inlineKovoLoaderInstallerReadableSource).toContain('const sq = escapeCssString;');
    expect(escapeCssString('target"bad\\id')).toBe('target\\"bad\\\\id');
  });

  it('generates the enhanced-navigation request header from the core protocol', () => {
    // SPEC.md §4.4: enhanced navigation must negotiate the no-loader document variant.
    expect(inlineKovoLoaderInstallerReadableSource).toContain(
      `acceptHeader: ${JSON.stringify(enhancedNavigationDocumentAcceptHeader)}`,
    );
    expect(inlineKovoLoaderInstallerReadableSource).toContain(
      'security.fetchDocument(requestedUrl.href, acceptHeader)',
    );
  });

  it('checks the shipped source literal against the executable installer artifact', async () => {
    // SPEC.md §4.4: the readable build, shipped source string, and callable inline loader are one artifact.
    const moduleSource = buildInlineKovoLoaderModuleSource();
    const driftedModuleSource = moduleSource.replace(
      'const doc=document;',
      'const doc=globalThis.document;',
    );
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-inline-loader-'));
    const targetPath = join(tempDir, 'inline-loader.ts');

    try {
      expect(() => assertInlineKovoLoaderModuleArtifactParity(moduleSource)).not.toThrow();
      expect(() => assertInlineKovoLoaderModuleArtifactParity(driftedModuleSource)).toThrow(
        'embedded installer artifacts drifted',
      );

      writeFileSync(targetPath, driftedModuleSource, 'utf8');
      await expect(emitInlineKovoLoaderModule({ check: true, targetPath })).rejects.toThrow(
        'embedded installer artifacts drifted',
      );
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it('does not overwrite outside files through inline-loader output aliases', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-inline-loader-output-alias-'));
    const outside = mkdtempSync(join(tmpdir(), 'kovo-inline-loader-outside-'));
    const outputDir = join(root, 'generated');
    mkdirSync(outputDir, { recursive: true });
    const symlinkOutside = join(outside, 'symlink.ts');
    const symlinkTarget = join(outputDir, 'symlink.ts');
    const hardlinkOutside = join(outside, 'hardlink.ts');
    const hardlinkTarget = join(outputDir, 'hardlink.ts');
    writeFileSync(symlinkOutside, 'outside-symlink\n', 'utf8');
    writeFileSync(hardlinkOutside, 'outside-hardlink\n', 'utf8');
    symlinkSync(symlinkOutside, symlinkTarget);
    linkSync(hardlinkOutside, hardlinkTarget);

    try {
      await emitInlineKovoLoaderModule({ targetPath: symlinkTarget });
      await emitInlineKovoLoaderModule({ targetPath: hardlinkTarget });
      expect(readFileSync(symlinkOutside, 'utf8')).toBe('outside-symlink\n');
      expect(readFileSync(hardlinkOutside, 'utf8')).toBe('outside-hardlink\n');
      expect(lstatSync(symlinkTarget).isSymbolicLink()).toBe(false);
      expect(lstatSync(hardlinkTarget).ino).not.toBe(lstatSync(hardlinkOutside).ino);
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it('rejects symlinked inline-loader output roots and parents', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-inline-loader-root-alias-'));
    const outside = mkdtempSync(join(tmpdir(), 'kovo-inline-loader-root-outside-'));
    const rootAlias = join(root, 'root-alias');
    const parentAlias = join(root, 'parent-alias');
    symlinkSync(outside, rootAlias, 'dir');
    symlinkSync(outside, parentAlias, 'dir');

    try {
      await expect(
        emitInlineKovoLoaderModule({ targetPath: join(rootAlias, 'inline-loader.ts') }),
      ).rejects.toThrow('must be a non-symbolic-link directory');
      await expect(
        emitInlineKovoLoaderModule({
          targetPath: join(parentAlias, 'nested', 'inline-loader.ts'),
        }),
      ).rejects.toThrow();
      expect(() => lstatSync(join(outside, 'inline-loader.ts'))).toThrow();
      expect(() => lstatSync(join(outside, 'nested'))).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it('wires runtime package build and check scripts through inline loader generation', () => {
    // SPEC.md §4.4: package-level build/check must fail before a stale inline loader ships.
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { scripts?: Record<string, string> };
    const rootManifest = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(manifest.scripts?.build).toBe('pnpm run build:inline-loader');
    expect(manifest.scripts?.check).toBe('pnpm run check:inline-loader');
    expect(manifest.scripts?.['build:inline-loader']).toBe(
      'node --experimental-strip-types src/inline-loader-build.ts',
    );
    expect(manifest.scripts?.['check:inline-loader']).toBe(
      'node --experimental-strip-types src/inline-loader-build.ts --check',
    );
    expect(manifest.scripts?.['check:inline-loader:trusted-types']).toBe(
      'vitest run src/inline-loader-trusted-types-routing.test.ts',
    );
    expect(rootManifest.scripts?.['check:inline-loader']).toBe(
      'pnpm --filter @kovojs/browser run check:inline-loader',
    );
    expect(rootManifest.scripts?.['check:inline-loader:trusted-types']).toBe(
      'pnpm --filter @kovojs/browser run check:inline-loader:trusted-types',
    );
    expect(rootManifest.scripts?.check).toContain('pnpm run check:inline-loader');
    expect(rootManifest.scripts?.check).toContain('pnpm run check:inline-loader:trusted-types');
    expect(rootManifest.scripts?.['check:build']).toContain('pnpm run check:inline-loader');
  });

  it('rejects template interpolation instead of silently rewriting it', () => {
    // SPEC.md §4.4: inline-loader generation must fail closed on unsupported source syntax.
    expect(() =>
      buildInlineKovoLoaderInstallerSource(
        ['function unsupportedTemplate(value) {', '  return `loader ${value}`;', '}'].join('\n'),
      ),
    ).toThrow('template interpolation');
  });

  it('rejects invalid inline loader JavaScript at build time', () => {
    // SPEC.md §4.4: generated bootstrap source must be syntax-checked before shipping.
    expect(() => buildInlineKovoLoaderInstallerSource('function invalidInlineLoader(')).toThrow(
      'invalid JavaScript',
    );
  });

  it('rejects only generated inline bootstraps that exceed the gzip budget', () => {
    // SPEC.md §4.4: the package build/check path enforces the always-loaded
    // bootstrap budget, while the deferred runtime module has no inline-byte cap.
    const source = createOversizedInlineLoaderSource();
    const minifiedSource = buildInlineKovoLoaderInstallerSource(source);
    const bootstrapSource = `(${minifiedSource})((url)=>import(url));`;

    expect(gzipSync(bootstrapSource).byteLength).toBeGreaterThan(inlineKovoLoaderGzipByteBudget);
    expect(() => assertInlineKovoLoaderBootstrapGzipBudget(minifiedSource)).toThrow(
      'exceeds SPEC.md §4.4 gzip budget',
    );
    expect(() => buildInlineKovoLoaderModuleSource(source)).not.toThrow();
  });

  it('trims custom import expressions in generated public bootstrap source', () => {
    expect(createInlineKovoLoaderSource(' globalThis.__kovoInlineImport ')).toContain(
      `)(${JSON.stringify(kovoDeferredRuntimeModulePath)},globalThis.__kovoInlineImport);`,
    );
    expect(
      createInlineKovoLoaderSource(' "/c/custom-runtime.js" ', ' globalThis.__kovoInlineImport '),
    ).toContain(')("/c/custom-runtime.js",globalThis.__kovoInlineImport);');
  });
});
