import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  assertInlineJisoLoaderModuleArtifactParity,
  buildInlineJisoLoaderModuleSource,
  buildInlineJisoLoaderInstallerReadableSource,
  buildInlineJisoLoaderInstallerSource,
  emitInlineJisoLoaderModule,
  inlineJisoLoaderGzipByteBudget,
  inlineJisoLoaderInstallerReadableSource,
} from './inline-loader-build.js';
import {
  createInlineJisoLoaderSource,
  inlineJisoLoaderInstallerSource,
  jisoLoaderSource,
} from './inline-loader.js';
import { createInlineJisoLoaderSource as createPublicInlineJisoLoaderSource } from './index.js';

function createOversizedInlineLoaderSource(): string {
  let state = 0x12345678;
  const payload = Array.from({ length: 1800 }, () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return `'${state.toString(36).padStart(7, '0')}'`;
  }).join(',');

  return [
    'function installInlineJisoLoader(importModule) {',
    `  const payload = [${payload}];`,
    '  return payload.length + Boolean(importModule);',
    '}',
  ].join('\n');
}

describe('inline loader build source', () => {
  it('pins the shipped minified installer to the deterministic source helper', () => {
    // SPEC.md §4.4: drift checks must compare the shipped bootstrap to readable source.
    expect(inlineJisoLoaderInstallerReadableSource).toBe(
      buildInlineJisoLoaderInstallerReadableSource(),
    );
    expect(inlineJisoLoaderInstallerReadableSource).toContain('\nfunction installInlineJisoLoader');
    expect(inlineJisoLoaderInstallerReadableSource).toContain("join('; ')");
    expect(buildInlineJisoLoaderInstallerSource()).toBe(inlineJisoLoaderInstallerSource);
  });

  it('emits the checked-in runtime module from the readable inline loader source', () => {
    // SPEC.md §4.4: build-time emission must keep the shipped bootstrap tied to readable source.
    const moduleSource = buildInlineJisoLoaderModuleSource();

    expect(() => assertInlineJisoLoaderModuleArtifactParity(moduleSource)).not.toThrow();
    expect(moduleSource).toBe(readFileSync(new URL('./inline-loader.ts', import.meta.url), 'utf8'));
    expect(moduleSource).toContain('const inlineJisoLoaderInstaller = (');
    expect(moduleSource).toContain('inlineJisoLoaderInstaller(importModule);');
    expect(moduleSource).not.toContain('eval');
  });

  it('checks the shipped source literal against the executable installer artifact', () => {
    // SPEC.md §4.4: the readable build, shipped source string, and callable inline loader are one artifact.
    const moduleSource = buildInlineJisoLoaderModuleSource();
    const driftedModuleSource = moduleSource.replace(
      'const doc=document;',
      'const doc=globalThis.document;',
    );
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-inline-loader-'));
    const targetPath = join(tempDir, 'inline-loader.ts');

    try {
      expect(() => assertInlineJisoLoaderModuleArtifactParity(moduleSource)).not.toThrow();
      expect(() => assertInlineJisoLoaderModuleArtifactParity(driftedModuleSource)).toThrow(
        'embedded installer artifacts drifted',
      );

      writeFileSync(targetPath, driftedModuleSource, 'utf8');
      expect(() => emitInlineJisoLoaderModule({ check: true, targetPath })).toThrow(
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
      'pnpm --filter @jiso/runtime run check:inline-loader',
    );
    expect(rootManifest.scripts?.check).toContain('pnpm run check:inline-loader');
    expect(rootManifest.scripts?.['check:build']).toContain('pnpm run check:inline-loader');
  });

  it('rejects template interpolation instead of silently rewriting it', () => {
    // SPEC.md §4.4: inline-loader generation must fail closed on unsupported source syntax.
    expect(() =>
      buildInlineJisoLoaderInstallerSource(
        ['function unsupportedTemplate(value) {', '  return `loader ${value}`;', '}'].join('\n'),
      ),
    ).toThrow('template interpolation');
  });

  it('rejects invalid inline loader JavaScript at build time', () => {
    // SPEC.md §4.4: generated bootstrap source must be syntax-checked before shipping.
    expect(() => buildInlineJisoLoaderInstallerSource('function invalidInlineLoader(')).toThrow(
      'invalid JavaScript',
    );
  });

  it('wraps the extracted installer source as the public bootstrap source', () => {
    // SPEC.md §4.4: the generated bootstrap is the always-loaded runtime path.
    expect(jisoLoaderSource).toBe(`(${inlineJisoLoaderInstallerSource})((url)=>import(url));`);
    expect(createPublicInlineJisoLoaderSource()).toBe(jisoLoaderSource);
    expect(gzipSync(jisoLoaderSource).byteLength).toBeLessThanOrEqual(
      inlineJisoLoaderGzipByteBudget,
    );
    expect(jisoLoaderSource).toBe(jisoLoaderSource.trim());
    expect(jisoLoaderSource).not.toMatch(/\n|\s{2,}/);
    expect(jisoLoaderSource).toMatch(
      /^\(function installInlineJisoLoader\(importModule\)\{.*\}\)\(\(url\)=>import\(url\)\);$/,
    );
  });

  it('rejects generated inline loader modules that exceed the gzip budget', () => {
    // SPEC.md §4.4: the package build/check path enforces the always-loaded 4KB bootstrap budget.
    const source = createOversizedInlineLoaderSource();
    const minifiedSource = buildInlineJisoLoaderInstallerSource(source);
    const bootstrapSource = `(${minifiedSource})((url)=>import(url));`;

    expect(gzipSync(bootstrapSource).byteLength).toBeGreaterThan(inlineJisoLoaderGzipByteBudget);
    expect(() => buildInlineJisoLoaderModuleSource(source)).toThrow(
      'exceeds SPEC.md §4.4 gzip budget',
    );
  });

  it('keeps minified wire-contract tokens pinned in the extracted installer', () => {
    // SPEC.md §4.4: inline and modular loaders must not drift on query/fragment wire effects.
    expect(inlineJisoLoaderInstallerSource).toBe(inlineJisoLoaderInstallerSource.trim());
    expect(inlineJisoLoaderInstallerSource).not.toMatch(/\n|\s{2,}/);
    expect(inlineJisoLoaderInstallerSource).toContain("join('; ')");
    expect(inlineJisoLoaderInstallerSource).toContain('[...new Set(');
    expect(inlineJisoLoaderInstallerSource).toContain('function tagClose(');
    expect(inlineJisoLoaderInstallerSource).toContain(
      'function readMutationResponseElementChunks(',
    );
    expect(inlineJisoLoaderInstallerSource).toContain(
      'function readInlineMutationResponseBodyChunks(',
    );
    expect(inlineJisoLoaderInstallerSource).toContain('const applyResponseChunks=(chunks)=>');
    expect(inlineJisoLoaderInstallerSource).toContain(
      'const applyResponseBody=(body)=>{applyResponseChunks(readInlineMutationResponseBodyChunks(body));}',
    );
    expect(inlineJisoLoaderInstallerSource).not.toContain('readChunks(');
    expect(inlineJisoLoaderInstallerSource).not.toContain("readAttribute(query.attrs,'name')");
    expect(inlineJisoLoaderInstallerSource).toContain(
      'detail:{attrs:query.attrs,content:query.content}',
    );
    expect(inlineJisoLoaderInstallerSource).not.toContain('queryBody');
    expect(inlineJisoLoaderInstallerSource).toContain(
      "element.getAttribute('fw-fragment-target')??element.id",
    );
    expect(inlineJisoLoaderInstallerSource).toContain("getAttribute('fw-param-types')");
    expect(inlineJisoLoaderInstallerSource).not.toContain('DOMParser');
    expect(inlineJisoLoaderInstallerSource).not.toContain('Math.random');
  });

  it('trims custom import expressions in generated public bootstrap source', () => {
    expect(createInlineJisoLoaderSource(' globalThis.__jisoInlineImport ')).toContain(
      ')(globalThis.__jisoInlineImport);',
    );
  });
});
