#!/usr/bin/env node
// Generates packages/ui/registry.json — the shadcn-style copy-in manifest.
//
// Phase 7 of plans/api-cleanup.md: @kovojs/ui is `private: true`. External apps
// do NOT install it; they copy a component's source into their own app (e.g.
// src/components/ui/) — "you own the code". The copied .tsx imports only PUBLIC,
// versioned packages: @kovojs/headless-ui (behavior), @kovojs/style (StyleX fork),
// @kovojs/core (component()), and optionally @kovojs/server (escape helpers). This manifest is
// the data a future `kovo add <component>` would consume to copy a component and
// its sibling dependencies, and it pins the public dependency surface each
// component needs so the boundary cannot silently drift.
//
// A static, checked-in registry.json is the source of truth; this script
// regenerates it from the component sources so the two stay in sync. Run:
//   node packages/ui/scripts/build-registry.mjs            # check (default)
//   node packages/ui/scripts/build-registry.mjs --write    # rewrite registry.json

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = fileURLToPath(new URL('../', import.meta.url));
const srcDir = path.join(pkgRoot, 'src');
const registryPath = path.join(pkgRoot, 'registry.json');

/** Deterministic string sort (explicit comparator for the repo lint rule). */
const sorted = (values) => [...values].sort((a, b) => a.localeCompare(b));

// The set of @kovojs packages a copied component is allowed to import. Each must
// be a PUBLIC, versioned package (or `component` from core) — never a
// @kovojs/ui-internal module. The smoke test (src/copy-in.test.ts) enforces that
// a copied component typechecks against exactly these.
const PUBLIC_KOVO_DEPS = new Set([
  '@kovojs/core',
  '@kovojs/headless-ui',
  '@kovojs/server',
  '@kovojs/style',
]);

/** Parse every `import … from '<mod>'` statement, returning { module, symbols[] }. */
function parseImports(source) {
  const results = [];
  const re = /import\s+(?:type\s+)?([^;]*?)\s+from\s+'([^']+)';/gs;
  let match;
  while ((match = re.exec(source)) !== null) {
    const clause = match[1].trim();
    const module = match[2];
    const symbols = [];
    const braced = clause.match(/\{([^}]*)\}/s);
    if (braced) {
      for (const part of braced[1].split(',')) {
        const name = part
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          .trim();
        if (name) symbols.push(name);
      }
    }
    results.push({ module, symbols });
  }
  return results;
}

/** Convert an exported component binding to its derived DOM leaf name. */
function bindingToLeafName(binding) {
  return binding
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/** Exported `component({ … })` definitions in a component file. */
function parseExportedComponents(source) {
  const re = /export const (\w+) = component\s*\(\s*\{/g;
  const names = [];
  let match;
  while ((match = re.exec(source)) !== null) names.push(match[1]);
  return names;
}

const files = sorted(
  readdirSync(srcDir).filter(
    (f) => f.endsWith('.tsx') && !f.includes('.test.') && f !== 'index.tsx',
  ),
);

const components = [];
const findings = [];

for (const file of files) {
  const name = file.replace(/\.tsx$/, '');
  const source = readFileSync(path.join(srcDir, file), 'utf8');
  const imports = parseImports(source);
  const exportedComponents = parseExportedComponents(source);
  const exportedLeafNames = new Set(exportedComponents.map(bindingToLeafName));

  const headlessUiSymbols = new Set();
  const styleSymbols = new Set();
  const serverSymbols = new Set();
  const coreSymbols = new Set();
  const uiComponents = new Set(); // sibling ui components copied alongside this one
  const otherDeps = new Set();

  for (const { module, symbols } of imports) {
    if (module === '@kovojs/headless-ui' || module.startsWith('@kovojs/headless-ui/')) {
      symbols.forEach((s) => headlessUiSymbols.add(s));
    } else if (module === '@kovojs/style') {
      if (symbols.length > 0) {
        symbols.forEach((s) => styleSymbols.add(s));
      } else {
        styleSymbols.add('*');
      }
    } else if (module === '@kovojs/server') symbols.forEach((s) => serverSymbols.add(s));
    else if (module === '@kovojs/core') symbols.forEach((s) => coreSymbols.add(s));
    else if (module === '@kovojs/ui' || module.startsWith('@kovojs/ui/')) {
      findings.push(`${file}: imports @kovojs/ui itself (${module}) — not copy-in safe`);
      otherDeps.add(module);
    } else if (module.startsWith('./') || module.startsWith('../')) {
      // Relative import = sibling ui component to copy alongside.
      uiComponents.add(module.replace(/^\.\//, '').replace(/\.(tsx|ts|js)$/, ''));
    } else if (module.startsWith('@kovojs/')) {
      // Any @kovojs import outside the public allowlist is a real finding: a
      // copied component would not resolve it from the public packages alone.
      if (!PUBLIC_KOVO_DEPS.has(module)) {
        findings.push(`${file}: imports non-allowlisted @kovojs package ${module}`);
        otherDeps.add(module);
      }
    }
    // Non-@kovojs (e.g. type-only TS lib) imports are not tracked here.
  }

  if (!exportedComponents.length) {
    findings.push(`${file}: does not export any component({ ... }) definitions`);
  } else if (!exportedLeafNames.has(name)) {
    findings.push(
      `${file}: registry name "${name}" is not derived from an exported component binding (${sorted(
        exportedComponents,
      ).join(', ')})`,
    );
  }

  components.push({
    name,
    title: exportedComponents[0] ?? name,
    files: [`src/${file}`],
    exports: exportedComponents,
    dependencies: {
      '@kovojs/headless-ui': sorted(headlessUiSymbols),
      ...(styleSymbols.size ? { '@kovojs/style': sorted(styleSymbols) } : {}),
      ...(coreSymbols.size ? { '@kovojs/core': sorted(coreSymbols) } : {}),
      ...(serverSymbols.size ? { '@kovojs/server': sorted(serverSymbols) } : {}),
      ...(otherDeps.size ? { other: sorted(otherDeps) } : {}),
    },
    uiComponents: sorted(uiComponents),
  });
}

const registry = {
  $comment:
    'shadcn-style copy-in registry for @kovojs/ui (private package). External apps copy a component .tsx into their own app (e.g. src/components/ui/) rather than installing @kovojs/ui. The copied source imports only PUBLIC, versioned packages: @kovojs/headless-ui (behavior), @kovojs/style (StyleX fork), @kovojs/core (component()), and optionally @kovojs/server (escape helpers). `dependencies` lists, per public package, the exact symbols a component imports; `uiComponents` lists sibling ui files to copy alongside it. This is the data a future `kovo add <component>` consumes. Regenerate with `node packages/ui/scripts/build-registry.mjs --write`. See site/content/guides/components.md and plans/api-cleanup.md Phase 7.',
  registryDependencies: ['@kovojs/headless-ui', '@kovojs/style', '@kovojs/core', '@kovojs/server'],
  components,
};

const serialized = `${JSON.stringify(registry, null, 2)}\n`;

if (findings.length) {
  console.error('registry findings (component imports a non-public symbol):');
  for (const f of findings) console.error(`  - ${f}`);
}

if (process.argv.includes('--write')) {
  writeFileSync(registryPath, serialized);
  console.log(`Wrote ${registryPath} (${components.length} components).`);
} else {
  // Compare by semantic content, not bytes: the checked-in registry.json is
  // normalized by `vp check` (the repo formatter), so its whitespace differs
  // from JSON.stringify output. Drift in the data (a new/changed component or
  // dependency) still fails; pure reformatting does not.
  let current = '';
  try {
    current = readFileSync(registryPath, 'utf8');
  } catch {
    current = '';
  }
  const sameContent = current && JSON.stringify(JSON.parse(current)) === JSON.stringify(registry);
  if (!sameContent) {
    console.error(
      'registry.json is out of date. Run: node packages/ui/scripts/build-registry.mjs --write (then `vp check --fix`)',
    );
    process.exit(1);
  }
  console.log(`registry.json is up to date (${components.length} components).`);
}

if (findings.length) process.exit(2);
