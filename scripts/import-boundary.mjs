import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appFacingRoots = [
  'examples',
  'packages/create-kovo/templates',
  'site/content',
  'site/scripts',
  'site/src',
  'site/tutorial',
];

const checkedExtensions = new Set(['.js', '.jsx', '.mjs', '.md', '.ts', '.tsx']);

const explicitlyAllowedInternalImports = new Set([
  'examples/commerce/src/app.ts -> @kovojs/server/internal/html',
  'examples/commerce/src/app.ts -> @kovojs/server/internal/wire',
  'examples/commerce/scripts/emit-components.mjs -> @kovojs/server/internal/wire',
  'examples/commerce/src/graph.ts -> @kovojs/core/internal/graph',
  'examples/crm/scripts/emit-components.mjs -> @kovojs/server/internal/wire',
  'examples/crm/scripts/emit-graph.mjs -> @kovojs/core/internal/derivation',
  'examples/crm/src/graph.ts -> @kovojs/core/internal/graph',
  'examples/stackoverflow/scripts/emit-components.mjs -> @kovojs/server/internal/wire',
  'examples/reference/src/app.ts -> @kovojs/core/internal/graph',
  'examples/stackoverflow/src/graph.ts -> @kovojs/core/internal/graph',
  'site/content/guides/components.md -> @kovojs/server/internal/html',
  'site/scripts/capture.mjs -> @kovojs/runtime/internal/inline-loader',
  'site/src/components/chrome.tsx -> @kovojs/server/internal/html',
  'site/src/components/docs-layout.tsx -> @kovojs/server/internal/html',
  'site/src/components/example-split.tsx -> @kovojs/server/internal/html',
  'site/src/components/gallery.tsx -> @kovojs/server/internal/html',
  'site/src/document-template.ts -> @kovojs/server/internal/html',
  'site/tutorial/steps/04-mutations/src/app.ts -> @kovojs/server/internal/wire',
  'site/tutorial/steps/05-optimistic/src/app.ts -> @kovojs/server/internal/wire',
  'site/tutorial/steps/06-streaming/src/app.ts -> @kovojs/server/internal/wire',
  'site/tutorial/steps/07-verification/src/app.ts -> @kovojs/server/internal/wire',
]);

export async function collectImportBoundaryViolations({
  rootDir = repoRootFromScript(),
  roots = appFacingRoots,
} = {}) {
  const files = [];
  for (const root of roots) {
    const absoluteRoot = path.join(rootDir, root);
    if (existsSync(absoluteRoot)) files.push(...(await collectFiles(absoluteRoot)));
  }

  const violations = [];
  for (const filePath of files) {
    const relativePath = slash(path.relative(rootDir, filePath));
    if (!shouldCheckFile(relativePath)) continue;

    const source = await readFile(filePath, 'utf8');
    if (isGeneratedArtifact(relativePath, source)) continue;

    for (const specifier of new Set(importSpecifiers(source))) {
      const tier = importBoundaryTier(specifier);
      if (tier === null) continue;
      if (tier === 'internal' && isTestFile(relativePath)) continue;
      if (isGeneratedImportTier(tier) && isAllowedGeneratedRead(relativePath)) continue;

      const allowKey = `${relativePath} -> ${specifier}`;
      const allowed = allowedImportBoundaryException(tier, allowKey);
      if (!allowed) {
        violations.push({
          fileName: relativePath,
          specifier,
          tier,
        });
      }
    }
  }

  return violations.sort(
    (left, right) =>
      left.fileName.localeCompare(right.fileName) ||
      left.specifier.localeCompare(right.specifier) ||
      left.tier.localeCompare(right.tier),
  );
}

export function nonPublicKovoImportTier(specifier) {
  if (specifier === '@kovojs/compiler' || specifier.startsWith('@kovojs/compiler/')) {
    return 'internal';
  }
  if (/^@kovojs\/[^/]+\/internal(?:\/|$)/.test(specifier)) return 'internal';
  if (/^@kovojs\/[^/]+\/generated(?:\/|$)/.test(specifier)) return 'generated';
  return null;
}

export function appLocalGeneratedImportTier(specifier) {
  return /^\.{1,2}\/(?:.*\/)?generated\//.test(specifier) ? 'app-local-generated' : null;
}

function importBoundaryTier(specifier) {
  return nonPublicKovoImportTier(specifier) ?? appLocalGeneratedImportTier(specifier);
}

function allowedImportBoundaryException(tier, allowKey) {
  if (tier === 'internal') return explicitlyAllowedInternalImports.has(allowKey);
  if (tier === 'generated' || tier === 'app-local-generated') return false;
  return false;
}

export function importSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[^'"()]*?\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function shouldCheckFile(relativePath) {
  if (relativePath.includes('/node_modules/')) return false;
  if (relativePath.includes('/dist/')) return false;

  return checkedExtensions.has(path.extname(relativePath));
}

function isGeneratedImportTier(tier) {
  return tier === 'generated' || tier === 'app-local-generated';
}

function isAllowedGeneratedRead(relativePath) {
  return (
    isEmitFreshnessScript(relativePath) ||
    isExplicitArtifactTest(relativePath) ||
    isExplicitArtifactFixture(relativePath)
  );
}

function isEmitFreshnessScript(relativePath) {
  if (!/(?:^|\/)scripts\//.test(relativePath)) return false;
  return /(?:^|\/)(?:emit|check)[^/]*\.[cm]?js$/.test(relativePath);
}

function isExplicitArtifactTest(relativePath) {
  if (!isTestFile(relativePath)) return false;
  return hasExplicitArtifactName(relativePath);
}

function isExplicitArtifactFixture(relativePath) {
  const basename = path.basename(relativePath);
  if (!/fixtures?\.[cm]?[jt]sx?$/.test(basename)) return false;
  return hasExplicitArtifactName(relativePath);
}

function hasExplicitArtifactName(relativePath) {
  return /(?:^|[./-])(?:artifact|artifacts|generated|graph)(?:[./-]|$)/.test(relativePath);
}

function isTestFile(relativePath) {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relativePath);
}

function isGeneratedArtifact(relativePath, source) {
  if (relativePath.includes('/generated/')) return true;
  return (
    source.startsWith('// @kovojs-ir') ||
    source.startsWith('/* @kovojs-ir */') ||
    source.includes('DO NOT EDIT') ||
    source.includes('generated by @kovojs')
  );
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      files.push(...(await collectFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function repoRootFromScript() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function slash(value) {
  return value.split(path.sep).join('/');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = await collectImportBoundaryViolations();
  if (violations.length > 0) {
    console.error('import-boundary: app-facing code imports non-public Kovo subpaths:');
    for (const violation of violations) {
      console.error(`- ${violation.fileName}: ${violation.specifier} (${violation.tier})`);
    }
    process.exitCode = 1;
  }
}
