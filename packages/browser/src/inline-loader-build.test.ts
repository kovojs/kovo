import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { enhancedNavigationDocumentAcceptHeader } from '@kovojs/core/internal/document-protocol';

import {
  assertInlineKovoLoaderModuleArtifactParity,
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
  const payload = Array.from({ length: 1800 }, () => {
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
    expect(buildInlineKovoLoaderInstallerSource()).toBe(inlineKovoLoaderInstallerSource);
    expect(inlineKovoLoaderInstallerSource).toContain("getAttribute('kovo-live-component')");
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
      `headers: { Accept: ${JSON.stringify(enhancedNavigationDocumentAcceptHeader)} }`,
    );
  });

  it('checks the shipped source literal against the executable installer artifact', () => {
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
      expect(() => emitInlineKovoLoaderModule({ check: true, targetPath })).toThrow(
        'embedded installer artifacts drifted',
      );
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
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
    expect(rootManifest.scripts?.['check:inline-loader']).toBe(
      'pnpm --filter @kovojs/browser run check:inline-loader',
    );
    expect(rootManifest.scripts?.check).toContain('pnpm run check:inline-loader');
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

  it('rejects generated inline loader modules that exceed the gzip budget', () => {
    // SPEC.md §4.4: the package build/check path enforces the always-loaded 8KB bootstrap budget.
    const source = createOversizedInlineLoaderSource();
    const minifiedSource = buildInlineKovoLoaderInstallerSource(source);
    const bootstrapSource = `(${minifiedSource})((url)=>import(url));`;

    expect(gzipSync(bootstrapSource).byteLength).toBeGreaterThan(inlineKovoLoaderGzipByteBudget);
    expect(() => buildInlineKovoLoaderModuleSource(source)).toThrow(
      'exceeds SPEC.md §4.4 gzip budget',
    );
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
