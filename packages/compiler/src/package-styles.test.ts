import fs, {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
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
    // Every @kovojs/ui component must emit extractable CSS. The former gap —
    // progress.tsx / skeleton.tsx / tabs.tsx referenced a `style.keyframes(...)`
    // const by identifier, which the static extractor could not resolve, so they
    // emitted no CSS and rendered unstyled (KV236) — is now closed: the extractor
    // recognizes `style.keyframes`, binds its name, and emits the @keyframes
    // block. Any name appearing here is a regression that ships an unstyled
    // component.
    expect(result.diagnostics.map((d) => d.fileName).sort()).toEqual([]);
  });

  it('emits each @keyframes block once for keyframes-using components (SPEC §13.1)', () => {
    const css = uiExtraction().css ?? '';
    // skeleton pulse, progress indeterminate slide, tabs panel fade are restored.
    const keyframeNames = [...css.matchAll(/@keyframes (kv-keyframes-[a-z0-9]+)\{/g)].map(
      (match) => match[1],
    );
    expect(new Set(keyframeNames).size).toBe(keyframeNames.length);
    expect(keyframeNames.length).toBeGreaterThanOrEqual(3);
    for (const name of keyframeNames) {
      expect(css.split(`@keyframes ${name}{`).length - 1, name).toBe(1);
    }
    for (const prefix of [
      'kv-skeleton-animation-',
      'kv-progress-animation-',
      'kv-tabs-animation-',
    ]) {
      expect(css).toMatch(
        new RegExp(
          `\\.${prefix}[a-z0-9]+(?:\\[[^\\]]+\\])?\\{animation-name:kv-keyframes-[a-z0-9]+\\}`,
        ),
      );
    }
    // Keyframes carry no cascade priority, so they are emitted outside @layer.
    expect(css).toMatch(/@keyframes kv-keyframes-[a-z0-9]+\{0%, 100%\{opacity:1\}/);
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
      expect(result.css).toContain('.kv-style-bg-');
      expect(result.css).not.toContain('.kv-app-bg-');
      expect(result.css).not.toContain('red');
      expect(result.cssAssets).toEqual([
        expect.objectContaining({
          criticalCss: expect.stringContaining('padding:8px'),
          href: '/assets/app.css',
          sourceFileName: 'app.css',
          styleRuleUsages: expect.arrayContaining([
            expect.objectContaining({
              source: expect.stringContaining('app.tsx#root'),
              styleRef: 'appStyles.root',
            }),
          ]),
        }),
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not follow a static-import symlink outside the app source root', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-app-css-symlink-'));
    const outside = mkdtempSync(join(tmpdir(), 'kovo-app-css-symlink-outside-'));

    try {
      writeFileSync(
        join(root, 'app.tsx'),
        `
import * as style from '@kovojs/style';
import { palette } from './palette.js';

const styles = style.create({ root: { color: palette.accent } });
export function App() {
  return <main {...style.attrs(styles.root)}>App</main>;
}
`,
        'utf8',
      );
      writeFileSync(
        join(outside, 'palette.ts'),
        `export const palette = { accent: 'outside-source-sentinel' } as const;`,
        'utf8',
      );
      symlinkSync(join(outside, 'palette.ts'), join(root, 'palette.ts'), 'file');

      const result = extractAppComponentCss({
        fileName: join(root, 'app.tsx'),
        packagePrefixDiscoveryRoot: root,
        source: '',
      });

      expect(result.sourceFiles).toEqual([join(root, 'app.tsx')]);
      expect(result.css).toBeNull();
      expect(result.diagnostics.map((diagnostic) => diagnostic.fileName)).toEqual(['app.tsx']);
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it('does not scan a package export target outside the package root', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-package-css-traversal-'));
    const packageDir = join(root, 'node_modules', '@fixture', 'ui');

    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(join(root, 'src/app.tsx'), `import '@fixture/ui';`, 'utf8');
      writeFileSync(
        join(packageDir, 'package.json'),
        JSON.stringify({ exports: { '.': '../outside.tsx' }, name: '@fixture/ui' }),
        'utf8',
      );
      writeFileSync(
        join(root, 'node_modules', '@fixture', 'outside.tsx'),
        `
import * as style from '@kovojs/style';
const styles = style.create({ root: { color: 'outside-package-sentinel' } });
export function Outside() {
  return <main {...style.attrs(styles.root)}>Outside</main>;
}
`,
        'utf8',
      );

      const result = extractPackageComponentCss('@fixture/ui', {
        fileName: join(root, 'src/app.tsx'),
        packagePrefixDiscoveryRoot: root,
        source: `import '@fixture/ui';`,
      });

      expect(result).toEqual({ css: null, cssAssets: [], diagnostics: [], sourceFiles: [] });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('keeps post-bootstrap fs and String substitutions outside source authority', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-app-css-late-intrinsics-'));
    const originalReadFileSync = fs.readFileSync;
    const originalIncludes = String.prototype.includes;
    let readPoisonHits = 0;
    let includesPoisonHits = 0;

    try {
      writeFileSync(
        join(root, 'app.tsx'),
        `
import * as style from '@kovojs/style';
const styles = style.create({ root: { color: 'teal' } });
export function App() {
  return <main {...style.attrs(styles.root)}>App</main>;
}
`,
        'utf8',
      );

      Reflect.set(fs, 'readFileSync', (() => {
        readPoisonHits += 1;
        return `import * as style from '@kovojs/style';\nconst styles = style.create({ root: { color: 'attacker' } });`;
      }) as typeof fs.readFileSync);
      String.prototype.includes = function (search, position) {
        if (search === 'style.create' || search === '@kovojs/style') {
          includesPoisonHits += 1;
          return false;
        }
        return Reflect.apply(originalIncludes, this, [search, position]);
      };
      syncBuiltinESMExports();

      const result = extractAppComponentCss({
        fileName: join(root, 'app.tsx'),
        packagePrefixDiscoveryRoot: root,
        source: '',
      });

      Reflect.set(fs, 'readFileSync', originalReadFileSync);
      String.prototype.includes = originalIncludes;
      syncBuiltinESMExports();
      expect(readPoisonHits).toBe(0);
      expect(includesPoisonHits).toBe(0);
      expect(result.css).toContain('color:teal');
      expect(result.css).not.toContain('attacker');
    } finally {
      Reflect.set(fs, 'readFileSync', originalReadFileSync);
      String.prototype.includes = originalIncludes;
      syncBuiltinESMExports();
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

  it('extracts route CSS split targets from aliased route imports', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-app-route-css-alias-'));

    try {
      mkdirSync(join(root, 'components'), { recursive: true });
      writeFileSync(
        join(root, 'routes.tsx'),
        `
import { route as defineRoute } from '@kovojs/server';
import { CheckoutSummary } from './components/checkout-summary.js';

export const checkout = defineRoute('/checkout', {
  page: () => <CheckoutSummary />,
});
`,
        'utf8',
      );
      writeFileSync(
        join(root, 'components/checkout-summary.tsx'),
        `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const styles = style.create({ root: { color: 'purple' } });
export const CheckoutSummary = component({
  queries: { checkout: checkoutQuery },
  render: () => <checkout-summary {...style.attrs(styles.root)}>Checkout</checkout-summary>,
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
          fragmentTargets: ['components/checkout-summary/checkout-summary'],
          route: '/checkout',
          sourceFileNames: ['components/checkout-summary.css'],
        },
      ]);
      expect(result.routePageFacts[0]?.route).toBe('/checkout');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
