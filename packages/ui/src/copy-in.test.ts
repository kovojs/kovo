import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Phase 7 of plans/api-cleanup.md — the @kovojs/ui copy-in model.
//
// @kovojs/ui is `private: true`. External apps do NOT install it; they copy a
// component's .tsx source into their own app ("you own the code", shadcn-style).
// The copied source must compile against ONLY the public, versioned packages it
// imports — @kovojs/core (component()), @kovojs/headless-ui (behavior),
// @kovojs/style (StyleX fork), and optionally @kovojs/server (escape helpers) — with NO
// dependency on any @kovojs/ui-internal module.
//
// This test proves the model end to end: it copies representative components
// into a scratch dir that resolves the public packages the same way an external
// app would (a flat node_modules with the three @kovojs deps), then typechecks
// the copied source with `tsc --noEmit`. A green run means a copied component
// compiles against the public deps alone. If a component imported a non-public
// symbol, resolution would fail here.

const srcDir = dirname(fileURLToPath(import.meta.url)); // packages/ui/src
const pkgRoot = dirname(srcDir); // packages/ui
const repoRoot = dirname(dirname(pkgRoot)); // packages/ui -> repo root

/** Resolve a CLI bin from the repo's pnpm-linked node_modules. */
function resolveBin(name: string): string {
  const candidates = [
    join(repoRoot, 'node_modules', '.bin', name),
    join(repoRoot, 'node_modules', '.pnpm', 'node_modules', '.bin', name),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  throw new Error(`Unable to resolve binary: ${name}`);
}

/** Symlink a workspace @kovojs package into a scratch app's node_modules. */
function linkKovoDep(nodeModules: string, pkg: string): void {
  const target = realpathSync(join(repoRoot, 'packages', pkg.slice('@kovojs/'.length)));
  mkdirSync(join(nodeModules, '@kovojs'), { recursive: true });
  // Use a junction-free relative symlink to the workspace source package.
  execFileSync('ln', ['-s', target, join(nodeModules, pkg)]);
}

const COMPONENTS = [
  { file: 'button.tsx', label: 'static (no headless behavior)' },
  { file: 'select.tsx', label: 'headless behavior (attributes + escapeHtml)' },
];

describe('@kovojs/ui copy-in model', () => {
  it('a copied component typechecks against the PUBLIC @kovojs deps alone', () => {
    const tempParent = join(pkgRoot, 'node_modules', '.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'kovo-ui-copy-in-'));

    try {
      // Lay out a scratch external app: copy the component sources into
      // src/components/ui/ and resolve the public deps via a flat node_modules.
      const componentsDir = join(root, 'src', 'components', 'ui');
      mkdirSync(componentsDir, { recursive: true });
      for (const { file } of COMPONENTS) {
        const source = readFileSync(join(srcDir, file), 'utf8');
        // Copy verbatim — the point is that the unmodified source compiles.
        execFileSync('cp', [join(srcDir, file), join(componentsDir, file)]);
        // Sanity: the copied source must NOT import @kovojs/ui itself.
        expect(source).not.toMatch(/from '@kovojs\/ui/);
      }

      const nodeModules = join(root, 'node_modules');
      mkdirSync(nodeModules, { recursive: true });
      for (const pkg of [
        '@kovojs/core',
        '@kovojs/headless-ui',
        '@kovojs/server',
        '@kovojs/style',
      ]) {
        linkKovoDep(nodeModules, pkg);
      }

      // Typecheck the copied components with the workspace's compiler flags but
      // WITHOUT inheriting any repo tsconfig — exactly an external app's setup.
      execFileSync(
        resolveBin('tsc'),
        [
          '--ignoreConfig',
          '--noEmit',
          '--jsx',
          'react-jsx',
          '--jsxImportSource',
          '@kovojs/server',
          '--module',
          'NodeNext',
          '--moduleResolution',
          'NodeNext',
          '--target',
          'ES2024',
          '--strict',
          '--skipLibCheck',
          '--exactOptionalPropertyTypes',
          '--noUncheckedIndexedAccess',
          '--verbatimModuleSyntax',
          '--types',
          'node',
          ...COMPONENTS.map(({ file }) => join('src', 'components', 'ui', file)),
        ],
        { cwd: root, stdio: 'pipe' },
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 60_000);

  it('registry.json pins only PUBLIC @kovojs deps for every component', () => {
    const registry = JSON.parse(readFileSync(join(pkgRoot, 'registry.json'), 'utf8')) as {
      components: {
        name: string;
        dependencies: Record<string, unknown>;
        uiComponents: string[];
      }[];
    };
    const PUBLIC = new Set([
      '@kovojs/core',
      '@kovojs/headless-ui',
      '@kovojs/server',
      '@kovojs/style',
    ]);

    expect(registry.components.length).toBeGreaterThan(0);
    for (const component of registry.components) {
      for (const dep of Object.keys(component.dependencies)) {
        // An `other` bucket would hold a non-allowlisted import — a real finding.
        expect(PUBLIC.has(dep), `${component.name} depends on non-public "${dep}"`).toBe(true);
      }
    }
  });
});
