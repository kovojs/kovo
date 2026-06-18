import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import { publicEntrySubpaths, publicPackages, repoRoot } from './public-packages.mjs';

const tsconfigPath = path.join(repoRoot, 'tsconfig.json');
const packagesRoot = path.join(repoRoot, 'packages');
const duplicateBaselinePath = path.join(
  repoRoot,
  'scripts/exported-symbol-duplicates.baseline.json',
);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function resolveExportTarget(target) {
  if (typeof target === 'string') return target;
  if (target === null || typeof target !== 'object') return null;
  return (
    target.source ??
    target.development ??
    target.types ??
    target.import ??
    target.default ??
    Object.values(target).find((value) => typeof value === 'string') ??
    null
  );
}

function importPathFor(packageName, subpath) {
  return subpath === '.' ? packageName : `${packageName}/${subpath.slice(2)}`;
}

function symbolKind(symbol, checker) {
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const flags = resolved.flags;
  const kinds = [];
  if (flags & ts.SymbolFlags.Value) kinds.push('value');
  if (flags & ts.SymbolFlags.Type) kinds.push('type');
  if (flags & ts.SymbolFlags.Namespace) kinds.push('namespace');
  return kinds.length === 0 ? 'unknown' : kinds.join('+');
}

function createProgram(files) {
  const config = ts.readConfigFile(tsconfigPath, (filePath) => ts.sys.readFile(filePath));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repoRoot);
  return ts.createProgram(files, { ...parsed.options, noEmit: true });
}

/** Resolve workspace package export-subpath targets that point at TS/TSX source files. */
export function packageExportEntries() {
  if (!existsSync(packagesRoot)) return [];
  const entries = [];
  for (const dir of readdirSync(packagesRoot).sort((left, right) => left.localeCompare(right))) {
    const packageJsonPath = path.join(packagesRoot, dir, 'package.json');
    if (!existsSync(packageJsonPath)) continue;
    const packageJson = readJson(packageJsonPath);
    const exportsMap = packageJson.exports;
    if (exportsMap === undefined) continue;

    const normalizedExports =
      typeof exportsMap === 'string' || Array.isArray(exportsMap)
        ? { '.': exportsMap }
        : exportsMap;
    if (normalizedExports === null || typeof normalizedExports !== 'object') continue;

    for (const [subpath, target] of Object.entries(normalizedExports)) {
      const resolved = resolveExportTarget(target);
      if (typeof resolved !== 'string') continue;
      if (!/\.tsx?$/.test(resolved)) continue;
      const absPath = path.join(packagesRoot, dir, resolved);
      if (!existsSync(absPath)) continue;
      entries.push({
        packageName: packageJson.name,
        packageDir: dir,
        subpath,
        importPath: importPathFor(packageJson.name, subpath),
        source: path.relative(repoRoot, absPath),
        absPath,
      });
    }
  }
  return entries.sort((left, right) => {
    const byPackage = left.packageName.localeCompare(right.packageName);
    if (byPackage !== 0) return byPackage;
    return left.subpath.localeCompare(right.subpath);
  });
}

export function exportedSymbolsReport() {
  const entries = packageExportEntries();
  const program = createProgram(entries.map((entry) => entry.absPath));
  const checker = program.getTypeChecker();

  const packages = [];
  let currentPackage = null;
  for (const entry of entries) {
    if (currentPackage?.name !== entry.packageName) {
      currentPackage = { name: entry.packageName, dir: entry.packageDir, exports: [] };
      packages.push(currentPackage);
    }

    const sourceFile = program.getSourceFile(entry.absPath);
    const moduleSymbol = sourceFile ? checker.getSymbolAtLocation(sourceFile) : undefined;
    const symbols = moduleSymbol
      ? checker
          .getExportsOfModule(moduleSymbol)
          .map((symbol) => ({
            name: symbol.name,
            kind: symbolKind(symbol, checker),
          }))
          .sort((left, right) => left.name.localeCompare(right.name))
      : [];

    currentPackage.exports.push({
      subpath: entry.subpath,
      importPath: entry.importPath,
      source: entry.source,
      symbols,
    });
  }

  return { packages };
}

/** Report public symbols exported from more than one public import path in the same package. */
export function duplicatePublicSymbolsReport(report = exportedSymbolsReport()) {
  const publicSubpathsByPackage = new Map(
    publicPackages().map((pkg) => [pkg.name, new Set(publicEntrySubpaths(pkg))]),
  );
  const duplicates = [];

  for (const pkg of report.packages) {
    const publicSubpaths = publicSubpathsByPackage.get(pkg.name);
    if (!publicSubpaths) continue;

    const homesBySymbol = new Map();
    for (const exportEntry of pkg.exports) {
      if (!publicSubpaths.has(exportEntry.subpath)) continue;

      for (const symbol of exportEntry.symbols) {
        const homes = homesBySymbol.get(symbol.name) ?? [];
        homes.push({
          importPath: exportEntry.importPath,
          kind: symbol.kind,
          subpath: exportEntry.subpath,
        });
        homesBySymbol.set(symbol.name, homes);
      }
    }

    for (const [symbol, homes] of homesBySymbol) {
      if (homes.length <= 1) continue;
      duplicates.push({
        packageName: pkg.name,
        symbol,
        homes: homes.sort((left, right) => left.importPath.localeCompare(right.importPath)),
      });
    }
  }

  return {
    duplicates: duplicates.sort((left, right) => {
      const byPackage = left.packageName.localeCompare(right.packageName);
      if (byPackage !== 0) return byPackage;
      return left.symbol.localeCompare(right.symbol);
    }),
  };
}

export function formatDuplicateSymbolsText(report) {
  if (report.duplicates.length === 0) return 'No duplicate public symbols.\n';

  return `${report.duplicates
    .map(
      (duplicate) =>
        `${duplicate.packageName}#${duplicate.symbol}: ${duplicate.homes
          .map((home) => `${home.importPath} [${home.kind}]`)
          .join(', ')}`,
    )
    .join('\n')}\n`;
}

function readDuplicateBaseline() {
  return normalizeDuplicateReport(JSON.parse(readFileSync(duplicateBaselinePath, 'utf8')));
}

function duplicateKey(duplicate) {
  return `${duplicate.packageName}#${duplicate.symbol}`;
}

function normalizeDuplicateReport(report) {
  return {
    duplicates: report.duplicates.map((duplicate) => ({
      packageName: duplicate.packageName,
      symbol: duplicate.symbol,
      homes: duplicate.homes.map((home) => ({
        importPath: home.importPath,
        kind: home.kind,
        subpath: home.subpath,
      })),
    })),
  };
}

function baselineDiff(actual, expected) {
  const actualKeys = new Set(actual.duplicates.map(duplicateKey));
  const expectedKeys = new Set(expected.duplicates.map(duplicateKey));
  return {
    added: actual.duplicates.filter((duplicate) => !expectedKeys.has(duplicateKey(duplicate))),
    removed: expected.duplicates.filter((duplicate) => !actualKeys.has(duplicateKey(duplicate))),
  };
}

function assertDuplicateBaseline(actual, expected) {
  const normalizedActual = normalizeDuplicateReport(actual);
  const normalizedExpected = normalizeDuplicateReport(expected);
  const actualText = JSON.stringify(normalizedActual, null, 2);
  const expectedText = JSON.stringify(normalizedExpected, null, 2);
  if (actualText === expectedText) return true;

  const diff = baselineDiff(normalizedActual, normalizedExpected);
  process.stderr.write(
    [
      `Duplicate public-symbol baseline changed: actual=${normalizedActual.duplicates.length} expected=${normalizedExpected.duplicates.length}`,
      ...diff.added.slice(0, 20).map((duplicate) => `ADDED ${duplicateKey(duplicate)}`),
      ...diff.removed.slice(0, 20).map((duplicate) => `REMOVED ${duplicateKey(duplicate)}`),
      'Update scripts/exported-symbol-duplicates.baseline.json only after classifying the API aliases in plans/api-export-cleanup.md.',
      '',
    ].join('\n'),
  );
  return false;
}

export function formatSymbolsText(report) {
  const lines = [];
  for (const pkg of report.packages) {
    lines.push(pkg.name);
    for (const exportEntry of pkg.exports) {
      lines.push(`  ${exportEntry.importPath} (${exportEntry.source})`);
      if (exportEntry.symbols.length === 0) {
        lines.push('    (no symbols)');
        continue;
      }
      for (const symbol of exportEntry.symbols) {
        lines.push(`    ${symbol.name} [${symbol.kind}]`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

export function run(args = process.argv.slice(2)) {
  const json = args.includes('--json');
  const duplicates = args.includes('--duplicates');
  const check = args.includes('--check');
  const help = args.includes('--help') || args.includes('-h');
  if (help) {
    process.stdout.write(
      [
        'Usage: pnpm symbols [--json] [--duplicates] [--check]',
        '',
        'Lists TypeScript symbols exported by each package export path under packages/*.',
        '--duplicates lists duplicate public symbols by package.',
        '--check compares --duplicates output with the committed duplicate baseline.',
        '',
      ].join('\n'),
    );
    return 0;
  }

  const report = duplicates ? duplicatePublicSymbolsReport() : exportedSymbolsReport();
  if (check) {
    if (!duplicates) {
      process.stderr.write('--check currently requires --duplicates.\n');
      return 2;
    }
    return assertDuplicateBaseline(report, readDuplicateBaseline()) ? 0 : 1;
  }

  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : duplicates
        ? formatDuplicateSymbolsText(report)
        : formatSymbolsText(report),
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run();
}
