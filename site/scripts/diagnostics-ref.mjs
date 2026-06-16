import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Generated diagnostics→fix catalog (plan: agent layer). One reference page
 * listing every framework diagnostic (KV###) with its severity, message, and
 * fix, sourced from `diagnosticDefinitions` exported by @kovojs/core (the same
 * registry the compiler/CLI emit and `vp run kovo-check` asserts against).
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

const CORE_DIST = new URL('dist/core/src/index.mjs', repoRoot);

/** Read the diagnostics registry from the built core dist (mirrors
 * tests/kovo-check.node.mjs). The dist must be built first (`pnpm run check:build`). */
async function loadDiagnosticDefinitions() {
  if (!existsSync(fileURLToPath(CORE_DIST))) {
    throw new Error(
      'diagnostics-ref: dist/core/src/index.mjs is missing — run `pnpm run check:build` first',
    );
  }
  const core = await import(CORE_DIST.href);
  const definitions = core.diagnosticDefinitions;
  if (!definitions || typeof definitions !== 'object') {
    throw new Error('diagnostics-ref: @kovojs/core does not export diagnosticDefinitions');
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
  return String(value).replaceAll('|', '\\|').replace(/\n/g, '<br>');
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
  const definitions = await loadDiagnosticDefinitions();
  await mkdir(outDir, { recursive: true });
  const page = renderPage(definitions);
  await writeFile(path.join(outDir, 'diagnostics.md'), page, 'utf8');

  const count = Object.keys(definitions).length;
  process.stdout.write(`diagnostics-ref/v1 codes=${count}\n`);
  return { codes: count };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await generateDiagnosticsReference();
}
