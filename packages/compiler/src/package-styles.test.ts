import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  extractAppComponentCss,
  extractAppRouteCssTargets,
  extractPackageComponentCss,
  normalizeNumericLengths,
} from './package-styles.js';

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

describe('normalizeNumericLengths (K2: served-CSS length normalizer)', () => {
  it('never px-ifies numeric CSS custom-property (--var) token values (SPEC §13.1)', () => {
    // `defineVars` emits `:root{--kovo-ns-token:VALUE}` raw (engine.ts:353) — a
    // custom property is opaque, not a length. The served-CSS normalizer's
    // bare-number regex matched `--kovo-t-ratio` and px-ified it, producing
    // invalid `--kovo-t-ratio:1.5px`. Declarations whose property starts with
    // `--` must pass through untouched.
    const normalized = normalizeNumericLengths(':root{--kovo-t-ratio:1.5}');
    expect(normalized).toContain('--kovo-t-ratio:1.5}');
    expect(normalized).not.toContain('1.5px');

    // Integer token values and multiple declarations are likewise preserved.
    const multi = normalizeNumericLengths(':root{--kovo-t-cols:3;--kovo-t-z:10}');
    expect(multi).toBe(':root{--kovo-t-cols:3;--kovo-t-z:10}');
  });

  it('still px-ifies genuine bare-number length declarations (no regression)', () => {
    // The intended normalization must keep working for real length properties.
    expect(normalizeNumericLengths('.x{padding:8}')).toBe('.x{padding:8px}');
    expect(normalizeNumericLengths('.x{max-width:832;gap:8}')).toBe('.x{max-width:832px;gap:8px}');
    // Unitless props and `0` stay bare even on a non-`--` property.
    expect(normalizeNumericLengths('.x{z-index:10;margin:0}')).toBe('.x{z-index:10;margin:0}');
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

const palette = { accent: 'teal' } as const;
const appStyles = style.create({
  root: {
    backgroundColor: palette.accent,
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
      expect(result.css).toContain('background-color:teal');
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

  it('extracts route CSS split targets relative to the app source root', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-app-route-css-'));

    try {
      mkdirSync(join(root, 'components'), { recursive: true });
      writeFileSync(
        join(root, 'routes.tsx'),
        `
import { route } from '@kovojs/server';
import { CartBadge } from './components/cart-badge.js';

export const cart = route('/cart', {
  page: () => <CartBadge />,
});
`,
        'utf8',
      );
      writeFileSync(
        join(root, 'components/cart-badge.tsx'),
        `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const styles = style.create({ root: { color: 'teal' } });
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: () => <cart-badge {...style.attrs(styles.root)}>Cart</cart-badge>,
});
`,
        'utf8',
      );

      const result = extractAppRouteCssTargets({
        fileName: join(root, 'routes.tsx'),
        packagePrefixDiscoveryRoot: root,
        source: '',
      });

      expect(result.routeTargets).toEqual([
        {
          fragmentTargets: ['components/cart-badge/cart-badge'],
          route: '/cart',
          sourceFileNames: ['components/cart-badge.css'],
        },
      ]);
      expect(result.routePageFacts[0]?.css).toEqual({
        fragmentTargets: ['components/cart-badge/cart-badge'],
        sourceFileNames: ['components/cart-badge.css'],
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
