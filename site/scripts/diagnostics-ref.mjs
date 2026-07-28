import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

/**
 * Generated diagnostics→fix catalog (plan: agent layer). One reference page
 * listing every framework diagnostic (KV###) with its severity, message, and
 * fix, sourced from the framework's internal `diagnosticDefinitions` registry
 * (the same registry the compiler/CLI emit and `vp run kovo-check` asserts
 * against).
 *
 * This is the indexed KV### reference agents (and humans) pattern-match. It is
 * emitted as a content page so it appears in the site nav and in llms-full.txt.
 * Output is deterministic: no timestamps, no absolute paths.
 */

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = new URL('../../', import.meta.url);

const SEVERITY_ORDER = ['error', 'warn', 'lint', 'notice'];

const SEVERITY_BLURB = {
  error: 'Build-blocking. `vp check` fails until you resolve it.',
  lint: 'Style/clarity guidance. Surfaced by `vp check`; non-blocking by default.',
  notice: 'Informational. The framework degraded behavior and is telling you how.',
  warn: 'Non-blocking warning. The check passes, but the framework wants your attention.',
};

const CORE_DIAGNOSTICS_SOURCE = new URL('packages/core/src/diagnostics.ts', repoRoot);
const PACKAGES_DIR = new URL('packages/', repoRoot);
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const KV_CODE_PATTERN = /\bKV\d{3}\b/g;
const DIAGNOSTICS_SPEC_RELATIVE_PATH = 'spec/11-diagnostics.md';
const LEGACY_DIAGNOSTICS_HEADING = '### 11.3 Diagnostic codes (registry)';
const INTENTIONAL_NON_FRAMEWORK_PLACEHOLDERS = [
  {
    code: 'KV999',
    pathPattern:
      /packages\/(?:core\/src\/graph|cli\/src\/(?:diagnostic|index\.kovo-check))\.test\.ts$/u,
    reason:
      'unknown-diagnostic-code rejection fixtures use a fake code that the framework must not register',
  },
  {
    code: 'KV999',
    pathPattern: /packages\/core\/src\/diagnostic-registry\.test\.ts$/u,
    reason: 'the runtime registry conformance test proves an unregistered code is rejected',
  },
];

/** Read the diagnostics registry from core's internal source so the catalog
 * follows the same registry used by framework tooling without keeping that
 * registry on the app-facing root API. */
async function loadDiagnosticDefinitions() {
  if (!existsSync(fileURLToPath(CORE_DIAGNOSTICS_SOURCE))) {
    throw new Error('diagnostics-ref: packages/core/src/diagnostics.ts is missing');
  }
  const core = await import(CORE_DIAGNOSTICS_SOURCE.href);
  const definitions = core.diagnosticDefinitions;
  if (!definitions || typeof definitions !== 'object') {
    throw new Error(
      'diagnostics-ref: core internal diagnostics do not export diagnosticDefinitions',
    );
  }
  return definitions;
}

/** Numeric ordering of KV codes (KV201, KV210, …, KV411) so the catalog is
 * stable regardless of object key order. */
function byCode(a, b) {
  return Number(a.slice(2)) - Number(b.slice(2));
}

function escapeCell(value) {
  // Markdown table cells: escape pipes and collapse newlines to <br> so the
  // multi-line help text stays on one row.
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '\\|')
    .replace(/\n/g, '<br>');
}

async function* walkSourceFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['dist', 'node_modules', 'templates', 'test'].includes(entry.name)) continue;
      yield* walkSourceFiles(child);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      yield child;
    }
  }
}

export function collectKvCodes(text, fileName = 'source.ts') {
  const codes = new Set(text.match(KV_CODE_PATTERN) ?? []);
  if (!/\\(?:[0-7]{1,3}|x[\da-fA-F]{2}|u(?:[\da-fA-F]{4}|\{[\da-fA-F]+\}))/u.test(text)) {
    return codes;
  }
  const extension = path.extname(fileName);
  const scriptKind =
    extension === '.tsx'
      ? ts.ScriptKind.TSX
      : extension === '.jsx'
        ? ts.ScriptKind.JSX
        : extension === '.js' || extension === '.mjs' || extension === '.cjs'
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind);
  const visit = (node) => {
    const decoded =
      ts.isIdentifier(node) ||
      ts.isStringLiteralLike(node) ||
      ts.isJsxText(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
        ? node.text
        : undefined;
    if (typeof decoded === 'string') {
      for (const match of decoded.matchAll(KV_CODE_PATTERN)) codes.add(match[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return codes;
}

function hasJustifiedPlaceholder(_text, code, sourceFile) {
  const relativeSourceFile = path
    .relative(fileURLToPath(repoRoot), sourceFile)
    .replaceAll(path.sep, '/');
  if (
    INTENTIONAL_NON_FRAMEWORK_PLACEHOLDERS.some(
      (placeholder) =>
        placeholder.code === code &&
        placeholder.reason.length > 0 &&
        placeholder.pathPattern.test(relativeSourceFile),
    )
  ) {
    return true;
  }

  return false;
}

export async function collectPackageSourceCodes({
  packagesDir = fileURLToPath(PACKAGES_DIR),
} = {}) {
  const codes = new Set();
  const packageEntries = await readdir(packagesDir, { withFileTypes: true });
  packageEntries.sort((a, b) => a.name.localeCompare(b.name));

  for (const packageEntry of packageEntries) {
    if (!packageEntry.isDirectory()) continue;
    const packageDir = path.join(packagesDir, packageEntry.name);
    for await (const sourceFile of walkSourceFiles(packageDir)) {
      const text = await readFile(sourceFile, 'utf8');
      for (const code of collectKvCodes(text, sourceFile)) {
        if (hasJustifiedPlaceholder(text, code, sourceFile)) continue;
        codes.add(code);
      }
    }
  }

  return codes;
}

export function collectDiagnosticRegistryCodesFromMarkdown(markdown) {
  const codes = new Set();
  for (const match of markdown.matchAll(/^\|\s*`?(KV\d{3})`?\s*\|/gmu)) {
    codes.add(match[1]);
  }
  return codes;
}

export async function collectSpecDiagnosticRegistryCodes({
  repoRootPath = fileURLToPath(repoRoot),
} = {}) {
  const splitRegistryPath = path.join(repoRootPath, DIAGNOSTICS_SPEC_RELATIVE_PATH);
  if (existsSync(splitRegistryPath)) {
    const source = await readFile(splitRegistryPath, 'utf8');
    const codes = collectDiagnosticRegistryCodesFromMarkdown(source);
    if (codes.size === 0) {
      throw new Error(
        `diagnostics-ref: ${DIAGNOSTICS_SPEC_RELATIVE_PATH} exists but contains no diagnostic registry table`,
      );
    }
    return { codes, enforceComplete: true, label: DIAGNOSTICS_SPEC_RELATIVE_PATH };
  }

  const spec = await readFile(path.join(repoRootPath, 'SPEC.md'), 'utf8');
  const sectionStart = spec.indexOf(LEGACY_DIAGNOSTICS_HEADING);
  if (sectionStart < 0) {
    throw new Error(
      `diagnostics-ref: ${DIAGNOSTICS_SPEC_RELATIVE_PATH} is missing and legacy SPEC §11.3 diagnostic table is missing`,
    );
  }
  const nextSection = spec.indexOf('\n### ', sectionStart + 1);
  const tableText = spec.slice(sectionStart, nextSection < 0 ? undefined : nextSection);
  const codes = collectDiagnosticRegistryCodesFromMarkdown(tableText);
  if (codes.size === 0) {
    throw new Error('diagnostics-ref: legacy SPEC §11.3 diagnostic table contains no KV### rows');
  }
  return { codes, enforceComplete: false, label: 'SPEC §11.3 diagnostic table' };
}

async function assertCatalogCoversFrameworkCodes(definitions, page) {
  const registryCodes = new Set(Object.keys(definitions));
  const [packageSourceCodes, specRegistry] = await Promise.all([
    collectPackageSourceCodes(),
    collectSpecDiagnosticRegistryCodes(),
  ]);

  const failures = [];
  const requiredCodeSources = [
    { codes: packageSourceCodes, label: 'packages/* source modules' },
    { codes: specRegistry.codes, label: specRegistry.label },
  ];
  for (const source of requiredCodeSources) {
    const missing = Array.from(source.codes)
      .filter((code) => !registryCodes.has(code))
      .sort(byCode);
    if (missing.length > 0) failures.push(`${source.label}: ${missing.join(', ')}`);
  }

  if (specRegistry.enforceComplete) {
    const missingFromNormativeRegistry = Array.from(registryCodes)
      .filter((code) => !specRegistry.codes.has(code))
      .sort(byCode);
    if (missingFromNormativeRegistry.length > 0) {
      failures.push(
        `${specRegistry.label}: missing registered diagnostics ${missingFromNormativeRegistry.join(', ')}`,
      );
    }
  }

  const missingFromPage = Array.from(registryCodes)
    .filter((code) => !page.includes(`\`${code}\``))
    .sort(byCode);
  if (missingFromPage.length > 0) {
    failures.push(`generated diagnostics catalog: ${missingFromPage.join(', ')}`);
  }

  if (failures.length > 0) {
    throw new Error(
      [
        `diagnostics-ref: every framework KV### emitted in package source modules, listed in ${specRegistry.label}, or registered in diagnosticDefinitions must agree with the generated catalog.`,
        ...failures.map((failure) => `- ${failure}`),
        'Intentional non-framework placeholders require an exact reviewed test-file entry in diagnostics-ref.mjs.',
      ].join('\n'),
    );
  }
}

function renderPage(definitions) {
  const codes = Object.keys(definitions).sort(byCode);

  const bySeverity = new Map(SEVERITY_ORDER.map((severity) => [severity, []]));
  for (const code of codes) {
    const definition = definitions[code];
    const bucket = bySeverity.get(definition.severity);
    if (!bucket) {
      throw new Error(`diagnostics-ref: ${code} has unknown severity "${definition.severity}"`);
    }
    bucket.push(definition);
  }

  const counts = SEVERITY_ORDER.map(
    (severity) => `${bySeverity.get(severity).length} ${severity}`,
  ).join(', ');

  const lines = [
    '---',
    'title: Diagnostics',
    'description: Every KV### diagnostic the framework emits, with its severity, message, and how to fix it.',
    'order: 1',
    '---',
    '',
    '# Diagnostics',
    '',
    `Generated from \`diagnosticDefinitions\` in \`packages/core/src/diagnostics.ts\` — ${codes.length} codes (${counts}). Do not edit by hand.`,
    '',
    'Every diagnostic Kovo emits has a stable `KV###` code. The compiler, the CLI, and `vp check` all draw their messages from the one registry below, so the code you see in your terminal is the code you look up here. Each entry lists what triggered it and the fix.',
    '',
  ];

  for (const severity of SEVERITY_ORDER) {
    const entries = bySeverity.get(severity);
    if (entries.length === 0) continue;
    const heading = `${severity.charAt(0).toUpperCase()}${severity.slice(1)}`;
    lines.push(`## ${heading}`, '', SEVERITY_BLURB[severity], '');
    lines.push('| Code | Message | Fix |', '| --- | --- | --- |');
    for (const definition of entries) {
      const fix = definition.help ? escapeCell(definition.help) : '*See message.*';
      lines.push(`| \`${definition.code}\` | ${escapeCell(definition.message)} | ${fix} |`);
    }
    lines.push('');
  }

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

export async function generateDiagnosticsReference({
  outDir = path.join(siteRoot, 'gen/reference'),
} = {}) {
  const { codes, page } = await checkDiagnosticsRegistryEquality();
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'diagnostics.md'), page, 'utf8');

  process.stdout.write(`diagnostics-ref/v1 codes=${codes}\n`);
  return { codes };
}

/**
 * Root-checkable, write-free equality proof for the normative SPEC registry, core definitions,
 * package KV references, and the generated diagnostics reference page. Keeping this separate from
 * site generation promotes registry drift detection into `pnpm run check` (SPEC §11).
 */
export async function checkDiagnosticsRegistryEquality() {
  const definitions = await loadDiagnosticDefinitions();
  const page = renderPage(definitions);
  await assertCatalogCoversFrameworkCodes(definitions, page);

  const count = Object.keys(definitions).length;
  return { codes: count, page };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await generateDiagnosticsReference();
}
