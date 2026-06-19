#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

function parseArgs(argv) {
  const args = { json: null, markdown: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      args.json = argv[(i += 1)];
    } else if (arg === '--markdown') {
      args.markdown = argv[(i += 1)];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function findRepoRoot(start) {
  let dir = path.resolve(start);
  while (true) {
    if (existsSync(path.join(dir, 'SPEC.md')) && existsSync(path.join(dir, 'public-packages.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Could not find Kovo repo root');
    dir = parent;
  }
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function ensureDirFor(file) {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
}

function resolveExportTarget(target) {
  if (typeof target === 'string') return target;
  if (target && typeof target === 'object') {
    return target.source ?? target.development ?? target.import ?? target.default ?? null;
  }
  return null;
}

function loadTsProgram(repoRoot, files) {
  const configPath = path.join(repoRoot, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, (file) => ts.sys.readFile(file));
  if (config.error) {
    const message = ts.flattenDiagnosticMessageText(config.error.messageText, '\n');
    throw new Error(`Could not read tsconfig: ${message}`);
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repoRoot);
  return ts.createProgram(files, { ...parsed.options, noEmit: true });
}

function docState(symbol, checker) {
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const declarations = resolved.declarations ?? [];
  const tags = new Set();
  const summaries = [];
  for (const declaration of declarations) {
    let node = declaration;
    if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
      node = node.parent.parent;
    }
    for (const tag of ts.getJSDocTags(node)) {
      tags.add(tag.tagName.getText());
    }
    const jsDocs = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc);
    for (const doc of jsDocs) {
      const summary = (ts.getTextOfJSDocComment(doc.comment) ?? '').trim();
      if (summary) summaries.push(summary.replace(/\s+/g, ' '));
    }
  }
  return {
    documented: summaries.length > 0,
    summary: summaries[0] ?? '',
    tags: [...tags].sort(),
  };
}

function declarationInfo(symbol, checker) {
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const declaration = resolved.declarations?.[0];
  if (!declaration) return null;
  const source = declaration.getSourceFile();
  const pos = source.getLineAndCharacterOfPosition(declaration.getStart(source));
  return {
    file: source.fileName,
    line: pos.line + 1,
    column: pos.character + 1,
    kind: ts.SyntaxKind[declaration.kind],
  };
}

function symbolType(symbol, checker) {
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const declaration = resolved.valueDeclaration ?? resolved.declarations?.[0];
  if (!declaration) return '';
  try {
    const type = checker.getTypeOfSymbolAtLocation(resolved, declaration);
    const signatures = type.getCallSignatures();
    if (signatures.length > 0) {
      return checker.signatureToString(signatures[0], declaration, ts.TypeFormatFlags.NoTruncation);
    }
    return checker.typeToString(type, declaration, ts.TypeFormatFlags.NoTruncation);
  } catch {
    return '';
  }
}

function collectSourceFiles(repoRoot) {
  const roots = ['examples', 'site', 'packages', 'tests', 'conformance'];
  const result = [];
  const stack = roots.map((root) => path.join(repoRoot, root)).filter((root) => existsSync(root));
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = ts.sys.readDirectory(current, undefined, ['node_modules', 'dist', 'site-export']);
    for (const entry of entries) {
      if (/\.[cm]?[tj]sx?$/.test(entry)) result.push(entry);
    }
  }
  return [...new Set(result)].sort();
}

function sourceArea(repoRoot, fileName) {
  const rel = path.relative(repoRoot, fileName);
  if (rel.startsWith('examples/')) return 'examples';
  if (rel.startsWith('site/')) return 'site';
  if (rel.startsWith('packages/')) return 'packages';
  if (rel.startsWith('tests/')) return 'tests';
  if (rel.startsWith('conformance/')) return 'conformance';
  return 'other';
}

function collectImports(repoRoot, files) {
  const importMap = new Map();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const area = sourceArea(repoRoot, file);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith('@kovojs/') && specifier !== 'kovo' && specifier !== 'create-kovo') {
        continue;
      }
      const clause = statement.importClause;
      if (!clause) continue;
      const record = importMap.get(specifier) ?? new Map();
      if (clause.name) {
        const symbol = 'default';
        const stats = record.get(symbol) ?? emptyImportStats();
        addImport(stats, area, repoRoot, file);
        record.set(symbol, stats);
      }
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          const symbol = element.propertyName?.text ?? element.name.text;
          const stats = record.get(symbol) ?? emptyImportStats();
          addImport(stats, area, repoRoot, file);
          record.set(symbol, stats);
        }
      }
      importMap.set(specifier, record);
    }
  }
  return importMap;
}

function emptyImportStats() {
  return {
    total: 0,
    examples: 0,
    site: 0,
    packages: 0,
    tests: 0,
    conformance: 0,
    files: [],
  };
}

function addImport(stats, area, repoRoot, file) {
  stats.total += 1;
  if (Object.hasOwn(stats, area)) stats[area] += 1;
  const rel = path.relative(repoRoot, file);
  if (!stats.files.includes(rel) && stats.files.length < 8) stats.files.push(rel);
}

function moduleSpecifier(pkgName, subpath) {
  return subpath === '.' ? pkgName : `${pkgName}${subpath.slice(1)}`;
}

function formatApiRefPath(pkg, subpath) {
  const entries = pkg.apiRef?.entries ?? [];
  const entry = entries.find((candidate) => candidate.path === subpath);
  const slug = entry?.slug ?? (subpath === '.' ? pkg.apiRef?.slug : null);
  return slug ? `site/gen/api/${slug}.md` : null;
}

async function main() {
  const args = parseArgs(process.argv);
  const repoRoot = findRepoRoot(process.cwd());
  const publicPackagesModule = await import(
    pathToFileURL(path.join(repoRoot, 'scripts/public-packages.mjs')).href
  );
  const manifest = readJson(path.join(repoRoot, 'public-packages.json'));
  const publicPackages = publicPackagesModule.publicPackages();
  const entries = [];
  for (const pkg of publicPackages) {
    const packageJson = readJson(path.join(repoRoot, 'packages', pkg.dir, 'package.json'));
    for (const [subpath, target] of Object.entries(packageJson.exports ?? {})) {
      if (publicPackagesModule.apiBoundaryTier(pkg, subpath) !== 'public') continue;
      const resolved = resolveExportTarget(target);
      if (!resolved || !/\.tsx?$/.test(resolved)) continue;
      const file = path.join(repoRoot, 'packages', pkg.dir, resolved);
      if (!existsSync(file)) continue;
      entries.push({ pkg, subpath, file, specifier: moduleSpecifier(pkg.name, subpath) });
    }
  }

  const program = loadTsProgram(
    repoRoot,
    entries.map((entry) => entry.file),
  );
  const checker = program.getTypeChecker();
  const imports = collectImports(repoRoot, collectSourceFiles(repoRoot));
  const exports = [];

  for (const entry of entries) {
    const source = program.getSourceFile(entry.file);
    const moduleSymbol = source ? checker.getSymbolAtLocation(source) : null;
    const symbols = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
    for (const symbol of symbols) {
      const doc = docState(symbol, checker);
      const declaration = declarationInfo(symbol, checker);
      const usage =
        imports.get(entry.specifier)?.get(symbol.name) ??
        imports.get(entry.pkg.name)?.get(symbol.name) ??
        emptyImportStats();
      exports.push({
        package: entry.pkg.name,
        packageDir: entry.pkg.dir,
        subpath: entry.subpath,
        specifier: entry.specifier,
        apiRef: formatApiRefPath(entry.pkg, entry.subpath),
        symbol: symbol.name,
        documented: doc.documented,
        summary: doc.summary,
        tags: doc.tags,
        declaration: declaration
          ? {
              file: path.relative(repoRoot, declaration.file),
              line: declaration.line,
              column: declaration.column,
              kind: declaration.kind,
            }
          : null,
        type: symbolType(symbol, checker),
        namedImports: usage,
      });
    }
  }

  exports.sort((left, right) =>
    `${left.package}${left.subpath}#${left.symbol}`.localeCompare(
      `${right.package}${right.subpath}#${right.symbol}`,
    ),
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    repoRoot,
    manifestComment: manifest.$comment ?? '',
    entries: entries.map((entry) => ({
      package: entry.pkg.name,
      subpath: entry.subpath,
      specifier: entry.specifier,
      source: path.relative(repoRoot, entry.file),
      apiRef: formatApiRefPath(entry.pkg, entry.subpath),
    })),
    exports,
  };

  if (args.json) {
    ensureDirFor(args.json);
    writeFileSync(args.json, `${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }

  if (args.markdown) {
    ensureDirFor(args.markdown);
    writeFileSync(args.markdown, renderMarkdown(payload));
  }
}

function renderMarkdown(payload) {
  const byEntry = new Map();
  for (const item of payload.exports) {
    const key = item.specifier;
    const list = byEntry.get(key) ?? [];
    list.push(item);
    byEntry.set(key, list);
  }
  const lines = [
    '# Public API Inventory',
    '',
    `Generated: ${payload.generatedAt}`,
    '',
    '| Entry | Exports | Named imports | Example imports | API ref |',
    '| --- | ---: | ---: | ---: | --- |',
  ];
  for (const [entry, items] of [...byEntry.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const totalImports = items.reduce((sum, item) => sum + item.namedImports.total, 0);
    const exampleImports = items.reduce((sum, item) => sum + item.namedImports.examples, 0);
    const apiRef = items.find((item) => item.apiRef)?.apiRef ?? '';
    lines.push(`| \`${entry}\` | ${items.length} | ${totalImports} | ${exampleImports} | \`${apiRef}\` |`);
  }
  lines.push('', '## Exports', '');
  for (const item of payload.exports) {
    const location = item.declaration
      ? `${item.declaration.file}:${item.declaration.line}`
      : 'unknown';
    lines.push(
      `- \`${item.specifier}#${item.symbol}\` (${item.declaration?.kind ?? 'unknown'}, ${location}) - named imports: ${item.namedImports.total}, examples: ${item.namedImports.examples}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
