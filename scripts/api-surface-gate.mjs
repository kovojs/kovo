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

function normalizedPath(fileName) {
  return path.resolve(fileName).split(path.sep).join('/');
}

function declarationPath(symbol, checker) {
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const declaration = resolved.declarations?.[0];
  if (!declaration) return null;
  return normalizedPath(declaration.getSourceFile().fileName);
}

function collectExportedSymbols(entries, program, checker) {
  const publicExportSymbols = new Set();
  const entryByPath = new Map();

  for (const entry of entries) {
    entryByPath.set(normalizedPath(entry.absPath), entry);
    if (entry.tier !== 'public') continue;

    const sourceFile = program.getSourceFile(entry.absPath);
    if (!sourceFile) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;

    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      const resolved =
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      publicExportSymbols.add(resolved);
    }
  }

  return { entryByPath, publicExportSymbols };
}

function referencedTypeSymbols(decls, checker) {
  const symbols = [];

  function pushSymbolAt(node) {
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol) return;
    const resolved =
      symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    symbols.push(resolved);
  }

  function visit(node) {
    if (ts.isTypeReferenceNode(node)) {
      pushSymbolAt(node.typeName);
    } else if (ts.isExpressionWithTypeArguments(node)) {
      pushSymbolAt(node.expression);
    } else if (ts.isImportTypeNode(node) && node.qualifier) {
      pushSymbolAt(node.qualifier);
    }
    ts.forEachChild(node, visit);
  }

  function visitTypeParameter(param) {
    if (param.constraint) visit(param.constraint);
    if (param.default) visit(param.default);
  }

  for (const decl of decls) {
    if (ts.isTypeAliasDeclaration(decl)) {
      decl.typeParameters?.forEach(visitTypeParameter);
      visit(decl.type);
      continue;
    }

    if (ts.isInterfaceDeclaration(decl) || ts.isClassDeclaration(decl)) {
      decl.typeParameters?.forEach(visitTypeParameter);
      decl.heritageClauses?.forEach(visit);
      for (const member of decl.members) visit(member);
      continue;
    }

    if (ts.isFunctionDeclaration(decl) || ts.isMethodSignature(decl)) {
      decl.typeParameters?.forEach(visitTypeParameter);
      decl.parameters.forEach((param) => {
        if (param.type) visit(param.type);
      });
      if (decl.type) visit(decl.type);
      continue;
    }

    if (ts.isVariableDeclaration(decl)) {
      if (decl.type) visit(decl.type);
      continue;
    }

    if (
      ts.isPropertySignature(decl) ||
      ts.isPropertyDeclaration(decl) ||
      ts.isParameter(decl) ||
      ts.isCallSignatureDeclaration(decl) ||
      ts.isConstructSignatureDeclaration(decl)
    ) {
      visit(decl);
    }
  }

  return symbols;
}

function isExternalDeclaration(symbol, checker) {
  if (symbol.declarations?.every((decl) => ts.isTypeParameterDeclaration(decl))) return true;
  const declarationFile = declarationPath(symbol, checker);
  if (!declarationFile) return true;
  if (declarationFile.includes('/node_modules/')) return true;
  return !declarationFile.startsWith(normalizedPath(repoRoot));
}

function recursivePublicnessViolationsForExport(exportSymbol, exportName, context, checker) {
  const violations = [];
  const queue = [{ symbol: exportSymbol, path: [exportName] }];
  const seen = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    const symbol = current.symbol;
    if (seen.has(symbol)) continue;
    seen.add(symbol);

    const decls = symbol.declarations ?? [];
    for (const referenced of referencedTypeSymbols(decls, checker)) {
      if (referenced === symbol) continue;
      if (context.publicExportSymbols.has(referenced)) {
        queue.push({ symbol: referenced, path: [...current.path, referenced.name] });
        continue;
      }
      if (isExternalDeclaration(referenced, checker)) continue;

      const state = symbolDocState(referenced, checker);
      const referencedPath = declarationPath(referenced, checker);
      const referencedEntry = referencedPath ? context.entryByPath.get(referencedPath) : undefined;
      const label = state.internal
        ? 'internal-type-in-public-signature'
        : state.generated
          ? 'generated-type-in-public-signature'
          : referencedEntry?.tier === 'internal'
            ? 'internal-entry-type-in-public-signature'
            : referencedEntry?.tier === 'generated'
              ? 'generated-entry-type-in-public-signature'
              : 'non-public-type-in-public-signature';

      violations.push({
        label,
        path: [...current.path, referenced.name].join(' -> '),
        symbol: referenced,
      });
      queue.push({ symbol: referenced, path: [...current.path, referenced.name] });
    }
  }

  return violations;
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
  const publicnessContext = collectExportedSymbols(entries, program, checker);
  const report = {
    undocumentedPublic: [],
    boundaryViolations: [],
    recursivePublicnessViolations: [],
  };

  for (const entry of entries) {
    const sourceFile = program.getSourceFile(entry.absPath);
    if (!sourceFile) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      const state = symbolDocState(symbol, checker);
      const violation = classifyExport({ tier: entry.tier, ...state });
      const id = exportId(entry, symbol.name);
      if (violation !== null) {
        if (violation === 'undocumented-public') {
          report.undocumentedPublic.push(id);
        } else {
          report.boundaryViolations.push(`${id} (${violation})`);
        }
      }

      if (entry.tier === 'public') {
        const resolved =
          symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        for (const recursiveViolation of recursivePublicnessViolationsForExport(
          resolved,
          symbol.name,
          publicnessContext,
          checker,
        )) {
          report.recursivePublicnessViolations.push(
            `${id} -> ${recursiveViolation.path} (${recursiveViolation.label})`,
          );
        }
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
    recursivePublicnessViolations: [...new Set(report.recursivePublicnessViolations)].sort(
      (left, right) => left.localeCompare(right),
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
  const recursivePublicnessViolations = report.recursivePublicnessViolations;

  if (write) {
    writeFileSync(
      baselinePath,
      `${JSON.stringify(
        {
          $comment:
            'api-surface gate ratchet baseline - known untagged/undocumented public exports and recursive publicness debt. Shrinks as plans/api-cleanup.md Phases 4-8 and audit-plan AUD-011 fixes land. Regenerate with `node scripts/api-surface-gate.mjs --write`. Never ADD entries by hand.',
          recursivePublicnessViolations,
          violations,
        },
        null,
        2,
      )}\n`,
    );
    process.stdout.write(
      `api-surface: wrote baseline with ${String(violations.length)} known violations and ${String(recursivePublicnessViolations.length)} recursive publicness violations\n`,
    );
    return { ok: true, violations, recursivePublicnessViolations, added: [], removed: [] };
  }

  const baseline = loadBaseline();
  if (baseline === null) {
    throw new Error('api-surface: no baseline; run `node scripts/api-surface-gate.mjs --write`');
  }
  const { added, removed } = compareViolations(baseline.violations, violations);
  const recursiveBaseline = baseline.recursivePublicnessViolations ?? [];
  const { added: addedRecursivePublicness, removed: removedRecursivePublicness } =
    compareViolations(recursiveBaseline, recursivePublicnessViolations);

  if (report.boundaryViolations.length > 0) {
    process.stderr.write(
      `api-surface: ${String(report.boundaryViolations.length)} boundary violation(s):\n` +
        report.boundaryViolations.map((v) => '  + ' + String(v)).join('\n') +
        `\nMove @internal/@generated exports behind manifest-declared non-public subpaths, or document public re-exported types. See rules/api-surface.md.\n`,
    );
    return {
      ok: false,
      violations,
      recursivePublicnessViolations,
      boundaryViolations: report.boundaryViolations,
      added,
      removed,
      addedRecursivePublicness,
      removedRecursivePublicness,
    };
  }

  if (addedRecursivePublicness.length > 0) {
    process.stderr.write(
      `api-surface: ${String(addedRecursivePublicness.length)} NEW recursive publicness violation(s):\n` +
        addedRecursivePublicness.map((v) => `  + ${v}`).join('\n') +
        `\nPublic signatures must not require internal/generated/non-public helper types recursively. See rules/api-surface.md.\n`,
    );
    return {
      ok: false,
      violations,
      recursivePublicnessViolations,
      boundaryViolations: [],
      added,
      removed,
      addedRecursivePublicness,
      removedRecursivePublicness,
    };
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
    `api-surface/v1 public-exports-needing-attention=${String(violations.length)} (baseline=${String(baseline.violations.length)}, fixed-this-run=${String(removed.length)}), recursive-publicness-needing-attention=${String(recursivePublicnessViolations.length)} (baseline=${String(recursiveBaseline.length)}, fixed-this-run=${String(removedRecursivePublicness.length)})\n`,
  );
  return {
    ok: true,
    violations,
    recursivePublicnessViolations,
    boundaryViolations: [],
    added,
    removed,
    addedRecursivePublicness,
    removedRecursivePublicness,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runGate({ write: process.argv.includes('--write') });
  if (!result.ok) process.exit(1);
}
