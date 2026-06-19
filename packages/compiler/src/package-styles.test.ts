import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { extractAppComponentCss, extractPackageComponentCss } from './package-styles.js';

// Walk up from this test file to the monorepo root (the dir that holds the
// `examples/` workspace + the hoisted `node_modules/@kovojs/ui` symlink).
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('repo root not found');
    dir = parent;
  }
}

// Resolve `@kovojs/ui` as if imported from an example app module, so the
// `node_modules` walk in resolvePackageManifestPath finds the workspace package.
function uiExtraction() {
  const root = repoRoot();
  return extractPackageComponentCss('@kovojs/ui', {
    fileName: join(root, 'examples', 'commerce', 'src', 'app.ts'),
    source: "import { Button } from '@kovojs/ui/button';",
    packagePrefixDiscoveryRoot: root,
  });
}

describe('extractPackageComponentCss over @kovojs/ui', () => {
  it('emits StyleX CSS for the core styled components', () => {
    const result = uiExtraction();
    expect(result.css).toBeTruthy();
    const css = result.css ?? '';
    // Deterministic, slug-cased namespaces pinned by the component sources
    // (button.tsx → button / buttonSize → button-size / buttonVariant → button-variant).
    expect(css).toContain('.kv-button-');
    expect(css).toContain('.kv-button-variant-');
    expect(css).toContain('.kv-card-');
    expect(css).toContain('.kv-badge-');
    // field.tsx composes a shared `nativeControlStyle` via spread — extracting it
    // proves the spread-resolution path (forms depend on Field).
    expect(css).toContain('.kv-field-');
    // CSS is emitted in cascade-priority @layer buckets (SPEC §13.1).
    expect(css).toContain('@layer kovo-style');
  });

  it('emits browser-valid CSS (units, layer idents, no nesting `&`)', () => {
    const css = uiExtraction().css ?? '';
    // Bare-number lengths get px; unitless properties stay bare.
    expect(css).toMatch(/font-size:\d+px/);
    expect(css).toMatch(/border-radius:\d+px/);
    expect(css).toMatch(/font-weight:\d+(?:[;}])/);
    // Layer sub-names must be valid idents (no digit-leading `.2000`).
    expect(css).not.toMatch(/@layer\s+kovo-style\.\d/);
    expect(css).toMatch(/@layer kovo-style-\d/);
    // No CSS-nesting `&` leaked into a flat atomic selector.
    expect(css).not.toContain('&');
  });

  it('reports coverage so unstyled components are never silent (A5 gate)', () => {
    const result = uiExtraction();
    // The gate must SCAN a broad surface; if this drops to a handful something
    // is mis-resolving the exports map.
    expect(result.sourceFiles.length).toBeGreaterThan(40);
    // Document the KNOWN coverage gap: progress.tsx / skeleton.tsx reference a
    // `style.keyframes(...)` const by identifier, which the static extractor does
    // not yet resolve, so they emit no CSS (would render unstyled). Examples must
    // not use animated Progress/Skeleton until keyframes resolution lands. Any
    // OTHER name appearing here is a regression that ships an unstyled component.
    expect(result.diagnostics.map((d) => d.fileName).sort()).toEqual([
      'src/progress.tsx',
      'src/skeleton.tsx',
    ]);
  });
});

describe('extractAppComponentCss', () => {
  it('extracts app-authored style.create CSS without generated artifacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-app-css-'));

    try {
      mkdirSync(join(root, 'generated'), { recursive: true });
      writeFileSync(
        join(root, 'app.tsx'),
        `
import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';

const appStyles = style.create({
  root: {
    color: tokens.sys.color.primary,
    padding: 8,
  },
});

export function App() {
  return <main {...style.attrs(appStyles.root)}>App</main>;
}
`,
        'utf8',
      );
      writeFileSync(
        join(root, 'generated/ignored.tsx'),
        `
import * as style from '@kovojs/style';
const generatedStyles = style.create({ root: { color: 'red' } });
`,
        'utf8',
      );

      const result = extractAppComponentCss({
        fileName: join(root, 'app.tsx'),
        packagePrefixDiscoveryRoot: root,
        source: '',
      });

      expect(result.sourceFiles).toEqual([join(root, 'app.tsx')]);
      expect(result.diagnostics).toEqual([]);
      expect(result.css).toContain('color:var(--kovo-theme-sys-color-primary)');
      expect(result.css).toContain('padding:8px');
      expect(result.css).not.toContain('red');
      expect(result.cssAssets).toEqual([
        expect.objectContaining({
          criticalCss: expect.stringContaining('padding:8px'),
          href: '/assets/app.css',
          sourceFileName: 'app.css',
        }),
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
