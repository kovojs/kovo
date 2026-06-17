import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import { apiBoundaryTier, publicPackages, repoRoot } from './public-packages.mjs';

/**
 * api-surface gate (plan api-boudnary Phase 1). Makes the public/internal/generated
 * boundary BINDING rather than conventional: app-facing public roots may not expose
 * `@internal` or `@generated` symbols, generated ABI subpaths may expose generated
 * symbols and documented public types, and internal subpaths may expose internal
 * symbols and documented public types. Untagged, undocumented public exports remain
 * ratcheted separately.
 *
 * The repo starts with a large pre-existing violation set (the audit found 70+
 * undocumented exports on @kovojs/core alone), so the gate runs as a RATCHET: a
 * committed baseline (`api-surface-baseline.json`) records the known violations and
 * the gate fails only on NEW ones. Phases 4–8 curate the surface and shrink the
 * baseline; `--write` regenerates it. See rules/api-surface.md.
 */

const baselinePath = path.join(repoRoot, 'api-surface-baseline.json');
const tsconfigPath = path.join(repoRoot, 'tsconfig.json');

/** Resolve every public-package export-subpath target that points at TS source. */
function publicEntryFiles() {
  const entries = [];
  for (const pkg of publicPackages()) {
    const pkgJson = JSON.parse(
      readFileSync(path.join(repoRoot, 'packages', pkg.dir, 'package.json'), 'utf8'),
    );
    const exportsMap = pkgJson.exports ?? {};
    for (const [subpath, target] of Object.entries(exportsMap)) {
      const resolved =
        typeof target === 'string'
          ? target
          : (target?.source ?? target?.development ?? target?.import ?? target?.default);
      if (typeof resolved !== 'string') continue;
      if (!/\.tsx?$/.test(resolved)) continue; // only source entries participate
      const absPath = path.join(repoRoot, 'packages', pkg.dir, resolved);
      if (!existsSync(absPath)) continue;
      entries.push({ pkg: pkg.name, subpath, absPath, tier: apiBoundaryTier(pkg, subpath) });
    }
  }
  return entries;
}

function createProgram(files) {
  const config = ts.readConfigFile(tsconfigPath, (f) => ts.sys.readFile(f));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repoRoot);
  return ts.createProgram(files, { ...parsed.options, noEmit: true });
}

function symbolDocState(symbol, checker) {
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const decls = resolved.declarations ?? [];
  let documented = false;
  let internal = false;
  let generated = false;
  for (const decl of decls) {
    let node = decl;
    if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
      node = node.parent.parent;
    }
    const tags = ts.getJSDocTags(node);
    if (tags.some((tag) => tag.tagName.getText() === 'internal')) internal = true;
    if (tags.some((tag) => tag.tagName.getText() === 'generated')) generated = true;
    const jsDoc = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc);
    // `doc.comment` is a string OR a NodeArray<JSDocComment> when the summary
    // contains inline tags like `{@link …}`; getTextOfJSDocComment flattens both.
    const summary = jsDoc
      .map((doc) => ts.getTextOfJSDocComment(doc.comment) ?? '')
      .join('')
      .trim();
    if (summary.length > 0) documented = true;
  }
  return { documented, internal, generated };
}

/** Every (package, subpath, symbol) whose export is neither documented nor @internal. */
export function computeViolations() {
  return computeSurfaceReport().undocumentedPublic;
}

function exportId(entry, symbolName) {
  return `${entry.pkg}${entry.subpath === '.' ? '' : entry.subpath}#${symbolName}`;
}

export function classifyExport({ tier, documented, internal, generated }) {
  if (tier === 'public') {
    if (internal) return 'internal-on-public';
    if (generated) return 'generated-on-public';
    if (!documented) return 'undocumented-public';
    return null;
  }
  if (tier === 'generated') {
    if (internal) return 'internal-on-generated';
    if (!generated && !documented) return 'untagged-on-generated';
    return null;
  }
  if (tier === 'internal') {
    if (generated) return 'generated-on-internal';
    if (!internal && !documented) return 'untagged-on-internal';
    return null;
  }
  return `unknown-tier:${tier}`;
}

/** Boundary report split into hard failures and ratcheted public-documentation debt. */
export function computeSurfaceReport() {
  const entries = publicEntryFiles();
  const program = createProgram(entries.map((entry) => entry.absPath));
  const checker = program.getTypeChecker();
  const report = {
    undocumentedPublic: [],
    boundaryViolations: [],
  };

  for (const entry of entries) {
    const sourceFile = program.getSourceFile(entry.absPath);
    if (!sourceFile) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      const state = symbolDocState(symbol, checker);
      const violation = classifyExport({ tier: entry.tier, ...state });
      if (violation === null) continue;
      const id = exportId(entry, symbol.name);
      if (violation === 'undocumented-public') {
        report.undocumentedPublic.push(id);
      } else {
        report.boundaryViolations.push(`${id} (${violation})`);
      }
    }
  }
  return {
    undocumentedPublic: [...new Set(report.undocumentedPublic)].sort((left, right) =>
      left.localeCompare(right),
    ),
    boundaryViolations: [...new Set(report.boundaryViolations)].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

function loadBaseline() {
  if (!existsSync(baselinePath)) return null;
  return JSON.parse(readFileSync(baselinePath, 'utf8'));
}

/** Pure ratchet comparison: which current violations are new vs the baseline, and which baselined ones are now fixed. */
export function compareViolations(baselineList, currentList) {
  const known = new Set(baselineList);
  const current = new Set(currentList);
  return {
    added: currentList.filter((v) => !known.has(v)),
    removed: baselineList.filter((v) => !current.has(v)),
  };
}

export function runGate({ write = false } = {}) {
  const report = computeSurfaceReport();
  const violations = report.undocumentedPublic;

  if (write) {
    writeFileSync(
      baselinePath,
      `${JSON.stringify(
        {
          $comment:
            'api-surface gate ratchet baseline - known untagged/undocumented public exports. Shrinks as plans/api-cleanup.md Phases 4-8 land. Regenerate with `node scripts/api-surface-gate.mjs --write`. Never ADD entries by hand.',
          violations,
        },
        null,
        2,
      )}\n`,
    );
    process.stdout.write(
      `api-surface: wrote baseline with ${String(violations.length)} known violations\n`,
    );
    return { ok: true, violations, added: [], removed: [] };
  }

  const baseline = loadBaseline();
  if (baseline === null) {
    throw new Error('api-surface: no baseline; run `node scripts/api-surface-gate.mjs --write`');
  }
  const { added, removed } = compareViolations(baseline.violations, violations);

  if (report.boundaryViolations.length > 0) {
    process.stderr.write(
      `api-surface: ${String(report.boundaryViolations.length)} boundary violation(s):\n` +
        report.boundaryViolations.map((v) => '  + ' + String(v)).join('\n') +
        `\nMove @internal/@generated exports behind manifest-declared non-public subpaths, or document public re-exported types. See rules/api-surface.md.\n`,
    );
    return { ok: false, violations, boundaryViolations: report.boundaryViolations, added, removed };
  }

  if (added.length > 0) {
    process.stderr.write(
      `api-surface: ${String(added.length)} NEW undocumented/untagged public export(s):\n` +
        added.map((v) => `  + ${v}`).join('\n') +
        `\nDocument them, tag @internal, or move them behind an internal subpath. See rules/api-surface.md.\n`,
    );
    return { ok: false, violations, boundaryViolations: [], added, removed };
  }
  process.stdout.write(
    `api-surface/v1 public-exports-needing-attention=${String(violations.length)} (baseline=${String(baseline.violations.length)}, fixed-this-run=${String(removed.length)})\n`,
  );
  return { ok: true, violations, boundaryViolations: [], added, removed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runGate({ write: process.argv.includes('--write') });
  if (!result.ok) process.exit(1);
}
