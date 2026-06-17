import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import { repoRoot } from './public-packages.mjs';

const tsconfigPath = path.join(repoRoot, 'tsconfig.json');
const packagesRoot = path.join(repoRoot, 'packages');

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
  const help = args.includes('--help') || args.includes('-h');
  if (help) {
    process.stdout.write(
      [
        'Usage: pnpm symbols [--json]',
        '',
        'Lists TypeScript symbols exported by each package export path under packages/*.',
        '',
      ].join('\n'),
    );
    return 0;
  }

  const report = exportedSymbolsReport();
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatSymbolsText(report));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run();
}
