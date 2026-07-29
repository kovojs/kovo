import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import { apiBoundaryTier, publicPackages, repoRoot } from './public-packages.mjs';
import { normalizePackageExports, resolveSourceExportTarget } from './package-exports.mjs';

/**
 * api-surface gate (plan api-boudnary Phase 1). Makes the public/internal/generated
 * boundary BINDING rather than conventional: app-facing public roots may not expose
 * `@internal` or `@generated` symbols, generated ABI subpaths may expose generated
 * symbols and documented public types, and internal subpaths may expose internal
 * symbols and documented public types. Untagged, undocumented public exports remain
 * ratcheted separately.
 *
 * The repo starts with a large pre-existing violation set, so the gate runs as a
 * RATCHET. The committed baseline records exact recursive-publicness identities and
 * per-package maxima. A repair must lower the matching package maximum in the same
 * change; replacing one leak with a different leak is still an addition. See
 * rules/api-surface.md and plans/api-surface-foundations.md (G17).
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
    const exportsMap = normalizePackageExports(pkgJson.exports);
    for (const [subpath, target] of Object.entries(exportsMap)) {
      const resolved = resolveSourceExportTarget(target);
      if (resolved === null) continue; // only source entries participate
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
    recursivePublicnessDetails: [],
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
          const violationId = `${id} -> ${recursiveViolation.path} (${recursiveViolation.label})`;
          report.recursivePublicnessViolations.push(violationId);
          report.recursivePublicnessDetails.push({
            id: violationId,
            package: entry.pkg,
            publicExport: id,
            path: recursiveViolation.path,
            label: recursiveViolation.label,
            leakedSymbol: recursiveViolation.symbol.name,
            leakedDeclaration: declarationPath(recursiveViolation.symbol, checker),
          });
        }
      }
    }
  }
  const recursivePublicnessDetails = [
    ...new Map(report.recursivePublicnessDetails.map((detail) => [detail.id, detail])).values(),
  ].sort((left, right) => left.id.localeCompare(right.id));
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
    recursivePublicnessDetails,
  };
}

function loadBaseline() {
  if (!existsSync(baselinePath)) return null;
  return JSON.parse(readFileSync(baselinePath, 'utf8'));
}

function baselineToDocument(baseline) {
  return baseline.toDocument ?? baseline.violations ?? [];
}

export function baselineToRemove(baseline) {
  if (baseline.recursivePublicness?.packages) {
    return Object.values(baseline.recursivePublicness.packages)
      .flatMap((entry) => entry.violations ?? [])
      .sort((left, right) => left.localeCompare(right));
  }
  return baseline.toRemove ?? baseline.recursivePublicnessViolations ?? [];
}

function recursivePackageCounts(details) {
  const counts = new Map();
  for (const detail of details) {
    counts.set(detail.package, (counts.get(detail.package) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function recursiveBaselinePackages(baseline) {
  return baseline.recursivePublicness?.packages ?? {};
}

export function recursiveRatchetComparison(baseline, currentDetails) {
  const current = currentDetails.map((detail) => detail.id);
  const baselineIds = baselineToRemove(baseline);
  const { added, removed } = compareViolations(baselineIds, current);
  const counts = recursivePackageCounts(currentDetails);
  const packages = recursiveBaselinePackages(baseline);
  const overBudget = [];
  for (const [packageName, count] of Object.entries(counts)) {
    const maximum = packages[packageName]?.maximum ?? 0;
    if (count > maximum) overBudget.push({ package: packageName, count, maximum });
  }
  return { added, removed, counts, overBudget };
}

function recursiveBaselineDocument(details) {
  const byPackage = new Map();
  for (const detail of details) {
    const ids = byPackage.get(detail.package) ?? [];
    ids.push(detail.id);
    byPackage.set(detail.package, ids);
  }
  const packages = {};
  for (const [packageName, ids] of [...byPackage.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    ids.sort((left, right) => left.localeCompare(right));
    packages[packageName] = { maximum: ids.length, violations: ids };
  }
  return { total: details.length, packages };
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
  const existingBaseline = loadBaseline();

  if (write) {
    if (existingBaseline?.schema === 'kovo-api-surface-baseline/v2') {
      const comparison = recursiveRatchetComparison(
        existingBaseline,
        report.recursivePublicnessDetails,
      );
      if (comparison.added.length > 0 || comparison.overBudget.length > 0) {
        throw new Error(
          'api-surface: refusing to widen the recursive-publicness ratchet; repair the new leak instead',
        );
      }
    }
    writeFileSync(
      baselinePath,
      `${JSON.stringify(
        {
          schema: 'kovo-api-surface-baseline/v2',
          $comment:
            'G17 ratchet. toDocument tracks documentation debt. recursivePublicness stores exact leak identities plus descending per-package maxima. `--write` accepts removals only and refuses additions.',
          toDocument: violations,
          recursivePublicness: recursiveBaselineDocument(report.recursivePublicnessDetails),
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

  const baseline = existingBaseline;
  if (baseline === null) {
    throw new Error('api-surface: no baseline; run `node scripts/api-surface-gate.mjs --write`');
  }
  const documentBaseline = baselineToDocument(baseline);
  const recursiveBaseline = baselineToRemove(baseline);
  const { added, removed } = compareViolations(documentBaseline, violations);
  const recursiveComparison = recursiveRatchetComparison(
    baseline,
    report.recursivePublicnessDetails,
  );
  const {
    added: addedRecursivePublicness,
    removed: removedRecursivePublicness,
    counts: recursivePackageCountsReport,
    overBudget: recursivePackagesOverBudget,
  } = recursiveComparison;

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

  if (addedRecursivePublicness.length > 0 || recursivePackagesOverBudget.length > 0) {
    process.stderr.write(
      `api-surface: ${String(addedRecursivePublicness.length)} NEW recursive publicness violation(s):\n` +
        addedRecursivePublicness.map((v) => `  + ${v}`).join('\n') +
        (recursivePackagesOverBudget.length > 0
          ? `\nPer-package ratchet overflow:\n${recursivePackagesOverBudget
              .map(
                (entry) =>
                  `  + ${entry.package}: ${String(entry.count)} > ${String(entry.maximum)}`,
              )
              .join('\n')}`
          : '') +
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
      recursivePackageCounts: recursivePackageCountsReport,
      recursivePackagesOverBudget,
    };
  }

  if (removedRecursivePublicness.length > 0) {
    process.stderr.write(
      `api-surface: ${String(removedRecursivePublicness.length)} recursive leak(s) were fixed, but the per-package ratchet is stale:\n` +
        removedRecursivePublicness.map((v) => `  - ${v}`).join('\n') +
        '\nRun `node scripts/api-surface-gate.mjs --write` to commit the descending maxima.\n',
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
      recursivePackageCounts: recursivePackageCountsReport,
      recursivePackagesOverBudget: [],
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
    `api-surface/v1 public-exports-needing-attention=${String(violations.length)} (baseline=${String(documentBaseline.length)}, fixed-this-run=${String(removed.length)}), recursive-publicness-needing-attention=${String(recursivePublicnessViolations.length)} (baseline=${String(recursiveBaseline.length)}, fixed-this-run=${String(removedRecursivePublicness.length)})\n`,
  );
  process.stdout.write(
    `api-surface/recursive-publicness-v2 total=${String(recursivePublicnessViolations.length)} ${Object.entries(
      recursivePackageCountsReport,
    )
      .map(([packageName, count]) => `${packageName}=${String(count)}`)
      .join(' ')}\n`,
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
    recursivePackageCounts: recursivePackageCountsReport,
    recursivePackagesOverBudget: [],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runGate({ write: process.argv.includes('--write') });
  if (!result.ok) process.exit(1);
}
