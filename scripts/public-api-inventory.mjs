#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import { normalizePackageExports, resolveSourceExportTarget } from './package-exports.mjs';
import { repoRoot as defaultRepoRoot } from './public-packages.mjs';

export const PUBLIC_API_INVENTORY_SCHEMA = 'kovo-public-api-inventory/v1';
export const PUBLIC_API_INVENTORY_EXCLUSION_SCHEMA = 'kovo-public-api-inventory-exclusion/v1';

export const CONSUMER_AREAS = Object.freeze([
  'authoredExamples',
  'authoredDocs',
  'packageInternals',
  'generatedEmit',
  'conformance',
  'tests',
]);

const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const DOC_EXTENSIONS = new Set(['.md', '.mdx']);
const ENTRYPOINT_EVIDENCE = '<entrypoint-only>';
const ALWAYS_EXCLUDED_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.kovo',
  '.next',
  '.nx',
  '.parcel-cache',
  '.turbo',
  '.vite',
  '.vitest-attachments',
  'build',
  'cache',
  'coverage',
  'dist',
  'gen',
  'generated',
  'node_modules',
  'out',
]);
const EXCLUSION_MARKER = '.kovo-public-api-inventory.json';
const DECLARED_CONSUMER_EXCLUSIONS = new Map([
  ['packed-fixture', 'declared-packed-fixture'],
  ['throwaway-app', 'declared-throwaway-app'],
]);

function compareStrings(left, right) {
  return left.localeCompare(right);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeText(filePath, text) {
  const absolute = path.resolve(filePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, text);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function wildcardMatch(pattern, value) {
  if (!pattern.includes('*')) return null;
  const parts = pattern.split('*');
  if (parts.length !== 2) return null;
  const match = new RegExp(`^${escapeRegExp(parts[0])}(.*)${escapeRegExp(parts[1])}$`, 'u').exec(
    value,
  );
  return match?.[1] ?? null;
}

function replaceWildcard(value, replacement) {
  if (typeof value === 'string') return value.replaceAll('*', replacement);
  if (Array.isArray(value)) return value.map((item) => replaceWildcard(item, replacement));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceWildcard(item, replacement)]),
    );
  }
  return value;
}

/** Resolve one manifest-declared subpath through an exact or wildcard package export. */
export function resolveManifestSubpath(exportsMap, subpath) {
  const normalized = normalizePackageExports(exportsMap);
  if (Object.hasOwn(normalized, subpath)) {
    return {
      exportPattern: subpath,
      generatedFamilyMember: false,
      target: resolveSourceExportTarget(normalized[subpath]),
    };
  }

  const matches = Object.entries(normalized)
    .map(([pattern, target]) => {
      const replacement = wildcardMatch(pattern, subpath);
      return replacement === null
        ? null
        : {
            exportPattern: pattern,
            generatedFamilyMember: true,
            specificity: pattern.replace('*', '').length,
            target: resolveSourceExportTarget(replaceWildcard(target, replacement)),
          };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        right.specificity - left.specificity ||
        compareStrings(left.exportPattern, right.exportPattern),
    );

  if (matches.length === 0) {
    return { exportPattern: null, generatedFamilyMember: false, target: null };
  }
  const [{ exportPattern, generatedFamilyMember, target }] = matches;
  return { exportPattern, generatedFamilyMember, target };
}

function moduleSpecifier(packageName, subpath) {
  return subpath === '.' ? packageName : `${packageName}/${subpath.slice(2)}`;
}

function apiRefPath(pkg, subpath) {
  const entry = (pkg.apiRef?.entries ?? []).find((candidate) => candidate.path === subpath);
  const slug = entry?.slug ?? (subpath === '.' ? pkg.apiRef?.slug : null);
  return slug ? `site/gen/api/${slug}.md` : null;
}

function publicManifestUnits(repoRoot) {
  const manifest = readJson(path.join(repoRoot, 'public-packages.json'));
  if (!Array.isArray(manifest.packages)) {
    throw new Error('public-packages.json: missing "packages" array');
  }

  const units = [];
  const findings = [];
  for (const pkg of manifest.packages.filter((candidate) => candidate.visibility === 'public')) {
    const packageJsonPath = path.join(repoRoot, 'packages', pkg.dir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      findings.push(`${pkg.name}: package manifest is missing at packages/${pkg.dir}/package.json`);
      continue;
    }
    const packageJson = readJson(packageJsonPath);
    const subpaths = pkg.apiBoundary?.public ?? [];
    if (!Array.isArray(subpaths)) {
      findings.push(`${pkg.name}: apiBoundary.public must be an array`);
      continue;
    }
    for (const subpath of subpaths) {
      const resolved = resolveManifestSubpath(packageJson.exports, subpath);
      const source =
        resolved.target === null ? null : path.posix.join('packages', pkg.dir, resolved.target);
      const absoluteSource = source === null ? null : path.resolve(repoRoot, source);
      const unit = {
        package: pkg.name,
        packageDir: pkg.dir,
        subpath,
        specifier: moduleSpecifier(pkg.name, subpath),
        exportPattern: resolved.exportPattern,
        source,
        apiRef: apiRefPath(pkg, subpath),
        kind: resolved.generatedFamilyMember ? 'generated-family-member' : 'typescript-entrypoint',
      };
      units.push(unit);

      if (resolved.target === null) {
        findings.push(`${unit.specifier}: public manifest subpath has no TypeScript source target`);
      } else if (!/\.tsx?$/u.test(resolved.target)) {
        findings.push(
          `${unit.specifier}: public source target is not TypeScript: ${resolved.target}`,
        );
      } else if (!existsSync(absoluteSource)) {
        findings.push(`${unit.specifier}: public source target does not exist: ${source}`);
      }
    }
  }

  units.sort((left, right) => compareStrings(left.specifier, right.specifier));
  return { findings, units };
}

function diagnosticFinding(diagnostic, repoRoot, label) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (!diagnostic.file || diagnostic.start === undefined) {
    return `${label}: TS${diagnostic.code} ${message}`;
  }
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const relative = path.relative(repoRoot, diagnostic.file.fileName).split(path.sep).join('/');
  return `${label}: ${relative}:${position.line + 1}:${position.character + 1} TS${diagnostic.code} ${message}`;
}

function tsProgram(repoRoot, files) {
  const configPath = path.join(repoRoot, 'tsconfig.json');
  const diagnostics = [];
  let options = {
    allowJs: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2024,
  };
  if (existsSync(configPath)) {
    const config = ts.readConfigFile(configPath, (filePath) => ts.sys.readFile(filePath));
    if (config.error) {
      diagnostics.push(diagnosticFinding(config.error, repoRoot, 'TypeScript config diagnostic'));
    } else {
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repoRoot);
      diagnostics.push(
        ...parsed.errors.map((diagnostic) =>
          diagnosticFinding(diagnostic, repoRoot, 'TypeScript config diagnostic'),
        ),
      );
      options = {
        ...options,
        ...parsed.options,
        composite: false,
        incremental: false,
        noEmit: true,
        tsBuildInfoFile: undefined,
      };
    }
  }
  const program = ts.createProgram(files, options);
  for (const diagnostic of [
    ...program.getConfigFileParsingDiagnostics(),
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ]) {
    diagnostics.push(diagnosticFinding(diagnostic, repoRoot, 'TypeScript program diagnostic'));
  }
  return { diagnostics: [...new Set(diagnostics)].sort(compareStrings), program };
}

function resolvedSymbol(symbol, checker) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

function declarationInfo(symbol, checker, repoRoot) {
  const declaration = resolvedSymbol(symbol, checker).declarations?.[0];
  if (!declaration) return null;
  const sourceFile = declaration.getSourceFile();
  const position = sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile));
  return {
    file: path.relative(repoRoot, sourceFile.fileName),
    line: position.line + 1,
    column: position.character + 1,
    syntaxKind: ts.SyntaxKind[declaration.kind],
  };
}

function declarationKind(symbol, checker) {
  const flags = resolvedSymbol(symbol, checker).flags;
  const kinds = [];
  if (flags & ts.SymbolFlags.Value) kinds.push('value');
  if (flags & ts.SymbolFlags.Type) kinds.push('type');
  if (flags & ts.SymbolFlags.Namespace) kinds.push('namespace');
  return kinds.length === 0 ? 'unknown' : kinds.join('+');
}

function documentation(symbol, checker) {
  const declarations = resolvedSymbol(symbol, checker).declarations ?? [];
  const tags = new Set();
  const summaries = [];
  for (const declaration of declarations) {
    let node = declaration;
    if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
      node = node.parent.parent;
    }
    for (const tag of ts.getJSDocTags(node)) tags.add(tag.tagName.getText());
    for (const doc of ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc)) {
      const summary = (ts.getTextOfJSDocComment(doc.comment) ?? '').trim();
      if (summary) summaries.push(summary.replace(/\s+/gu, ' '));
    }
  }
  return {
    documented: summaries.length > 0,
    summary: summaries[0] ?? '',
    tags: [...tags].sort(compareStrings),
  };
}

function symbolType(symbol, checker) {
  const resolved = resolvedSymbol(symbol, checker);
  const declaration = resolved.valueDeclaration ?? resolved.declarations?.[0];
  if (!declaration) return '';
  try {
    const type = checker.getTypeOfSymbolAtLocation(resolved, declaration);
    const signature = type.getCallSignatures()[0];
    return signature
      ? checker.signatureToString(signature, declaration, ts.TypeFormatFlags.NoTruncation)
      : checker.typeToString(type, declaration, ts.TypeFormatFlags.NoTruncation);
  } catch {
    return '';
  }
}

function emptyConsumerEvidence() {
  return Object.fromEntries(CONSUMER_AREAS.map((area) => [area, { imports: 0, files: [] }]));
}

function totalEvidence(evidence) {
  return CONSUMER_AREAS.reduce((total, area) => total + evidence[area].imports, 0);
}

function addEvidence(evidence, area, relativeFile) {
  const bucket = evidence[area];
  bucket.imports += 1;
  if (!bucket.files.includes(relativeFile)) bucket.files.push(relativeFile);
}

function declaredConsumerExclusion(directory) {
  const markerPath = path.join(directory, EXCLUSION_MARKER);
  if (existsSync(markerPath)) {
    const markerStat = lstatSync(markerPath);
    if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
      throw new Error(`${markerPath}: inventory exclusion marker must be a regular file`);
    }
    const marker = readJson(markerPath);
    if (marker.schema !== PUBLIC_API_INVENTORY_EXCLUSION_SCHEMA) {
      throw new Error(`${markerPath}: schema must be ${PUBLIC_API_INVENTORY_EXCLUSION_SCHEMA}`);
    }
    const reason = DECLARED_CONSUMER_EXCLUSIONS.get(marker.kind);
    if (!reason) throw new Error(`${markerPath}: kind must be packed-fixture or throwaway-app`);
    return reason;
  }

  const packageJsonPath = path.join(directory, 'package.json');
  if (!existsSync(packageJsonPath)) return null;
  const packageJsonStat = lstatSync(packageJsonPath);
  if (!packageJsonStat.isFile() || packageJsonStat.isSymbolicLink()) return null;
  const kind = readJson(packageJsonPath)?.kovoInventory?.consumerKind;
  if (kind === undefined) return null;
  const reason = DECLARED_CONSUMER_EXCLUSIONS.get(kind);
  if (!reason) {
    throw new Error(
      `${packageJsonPath}: kovoInventory.consumerKind must be packed-fixture or throwaway-app`,
    );
  }
  return reason;
}

function excludedDirectoryReason(directory, name) {
  if (name === 'node_modules') return 'nested-dependency';
  if (ALWAYS_EXCLUDED_DIRECTORIES.has(name)) return 'generated-dist-cache';
  return declaredConsumerExclusion(directory);
}

function consumerArea(relativeFile) {
  const normalized = relativeFile.split(path.sep).join('/');
  if (normalized.startsWith('conformance/')) return 'conformance';
  if (
    normalized.startsWith('packages/create-kovo/templates/') ||
    normalized.includes('/fixtures/emitted/') ||
    normalized.includes('/fixtures/generated-emit/')
  ) {
    return 'generatedEmit';
  }
  if (
    normalized.startsWith('tests/') ||
    /(?:^|\/)(?:__tests__|test)(?:\/|$)/u.test(normalized) ||
    /\.(?:browser\.)?(?:test|spec)\.[cm]?[jt]sx?$/u.test(normalized)
  ) {
    return 'tests';
  }
  if (normalized.startsWith('examples/')) return 'authoredExamples';
  if (
    normalized.startsWith('site/') ||
    normalized.startsWith('docs/') ||
    /(?:^|\/)README(?:\.[^/]+)?\.mdx?$/iu.test(normalized)
  ) {
    return 'authoredDocs';
  }
  if (normalized.startsWith('packages/')) return 'packageInternals';
  return null;
}

function walkConsumerFiles(repoRoot) {
  const scanRoots = ['examples', 'site', 'docs', 'packages', 'tests', 'conformance'];
  const files = [];
  const excludedDirectories = [];
  const seenDirectories = new Set();

  function walk(directory) {
    const realKey = path.resolve(directory);
    if (seenDirectories.has(realKey)) return;
    seenDirectories.add(realKey);
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      compareStrings(left.name, right.name),
    )) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        excludedDirectories.push({
          path: path.relative(repoRoot, absolute).split(path.sep).join('/'),
          reason: 'symbolic-link',
        });
        continue;
      }
      if (entry.isDirectory()) {
        const reason = excludedDirectoryReason(absolute, entry.name);
        if (reason !== null) {
          excludedDirectories.push({
            path: path.relative(repoRoot, absolute).split(path.sep).join('/'),
            reason,
          });
        } else {
          walk(absolute);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(extension) && !DOC_EXTENSIONS.has(extension)) continue;
      const relativeFile = path.relative(repoRoot, absolute).split(path.sep).join('/');
      const area = consumerArea(relativeFile);
      if (area !== null) files.push({ absolute, relativeFile, area, extension });
    }
  }

  for (const scanRoot of scanRoots) {
    const absolute = path.join(repoRoot, scanRoot);
    if (existsSync(absolute) && lstatSync(absolute).isDirectory()) walk(absolute);
  }
  for (const name of ['README.md', 'README.mdx']) {
    const absolute = path.join(repoRoot, name);
    if (!existsSync(absolute) || !lstatSync(absolute).isFile()) continue;
    files.push({
      absolute,
      relativeFile: name,
      area: 'authoredDocs',
      extension: path.extname(name).toLowerCase(),
    });
  }
  return {
    files: files.sort((left, right) => compareStrings(left.relativeFile, right.relativeFile)),
    excludedDirectories: excludedDirectories.sort((left, right) =>
      compareStrings(left.path, right.path),
    ),
  };
}

function markdownCode(text) {
  const blocks = [];
  const fence = /```(?:[cm]?[jt]sx?|typescript|javascript)(?:[ \t][^\n]*)?\n([\s\S]*?)```/giu;
  for (const match of text.matchAll(fence)) blocks.push(match[1]);
  const importLines =
    text.match(/^\s*(?:import|export)\s+(?:type\s+)?[^\n]*?\s+from\s+['"][^'"]+['"];?\s*$/gmu) ??
    [];
  return [...blocks, ...importLines].join('\n');
}

function publicSpecifier(specifier, publicSpecifiers) {
  return publicSpecifiers.has(specifier) ? specifier : null;
}

function consumerImports(file, publicSpecifiers, repoRoot) {
  const raw = readFileSync(file.absolute, 'utf8');
  const text = DOC_EXTENSIONS.has(file.extension) ? markdownCode(raw) : raw;
  const sourceFile = ts.createSourceFile(
    file.absolute,
    text,
    ts.ScriptTarget.Latest,
    true,
    DOC_EXTENSIONS.has(file.extension) || file.extension.endsWith('x')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );
  const imports = [];
  const findings = DOC_EXTENSIONS.has(file.extension)
    ? []
    : (sourceFile.parseDiagnostics ?? []).map((diagnostic) =>
        diagnosticFinding(diagnostic, repoRoot, 'TypeScript consumer parse diagnostic'),
      );
  const namespaceBindings = new Map();
  const bindingCounts = new Map();

  function add(specifier, symbol) {
    const matched = publicSpecifier(specifier, publicSpecifiers);
    if (matched !== null) imports.push({ specifier: matched, symbol });
  }

  function requiredSpecifier(node) {
    return ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
      ? node.arguments[0].text
      : null;
  }

  function isConstDeclaration(node) {
    return (
      ts.isVariableDeclaration(node) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    );
  }

  function countBindingName(name) {
    if (ts.isIdentifier(name)) {
      bindingCounts.set(name.text, (bindingCounts.get(name.text) ?? 0) + 1);
      return;
    }
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) countBindingName(element.name);
      }
    }
  }

  function countBindings(node) {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      countBindingName(node.name);
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isImportClause(node) ||
        ts.isNamespaceImport(node) ||
        ts.isImportSpecifier(node)) &&
      node.name
    ) {
      countBindingName(node.name);
    }
    ts.forEachChild(node, countBindings);
  }
  countBindings(sourceFile);

  function namespaceSpecifier(identifier) {
    return bindingCounts.get(identifier.text) === 1
      ? (namespaceBindings.get(identifier.text) ?? null)
      : null;
  }

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (!clause) {
        add(specifier, ENTRYPOINT_EVIDENCE);
        continue;
      }
      if (clause.name) add(specifier, 'default');
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          add(specifier, element.propertyName?.text ?? element.name.text);
        }
      } else if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        if (bindingCounts.get(clause.namedBindings.name.text) === 1) {
          namespaceBindings.set(clause.namedBindings.name.text, specifier);
        }
        add(specifier, ENTRYPOINT_EVIDENCE);
      }
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const specifier = statement.moduleSpecifier.text;
      if (!statement.exportClause) {
        add(specifier, ENTRYPOINT_EVIDENCE);
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          add(specifier, element.propertyName?.text ?? element.name.text);
        }
      } else {
        add(specifier, ENTRYPOINT_EVIDENCE);
      }
    }
  }

  function visit(node) {
    if (
      isConstDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      requiredSpecifier(node.initializer) !== null
    ) {
      const specifier = requiredSpecifier(node.initializer);
      if (bindingCounts.get(node.name.text) === 1) {
        namespaceBindings.set(node.name.text, specifier);
      }
      add(specifier, ENTRYPOINT_EVIDENCE);
    } else if (
      isConstDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      namespaceSpecifier(node.initializer) !== null
    ) {
      if (bindingCounts.get(node.name.text) === 1) {
        namespaceBindings.set(node.name.text, namespaceSpecifier(node.initializer));
      }
    } else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      namespaceSpecifier(node.expression) !== null
    ) {
      add(namespaceSpecifier(node.expression), node.name.text);
    } else if (
      ts.isQualifiedName(node) &&
      ts.isIdentifier(node.left) &&
      namespaceSpecifier(node.left) !== null
    ) {
      add(namespaceSpecifier(node.left), node.right.text);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      namespaceSpecifier(node.expression) !== null &&
      node.argumentExpression &&
      ts.isStringLiteral(node.argumentExpression)
    ) {
      add(namespaceSpecifier(node.expression), node.argumentExpression.text);
    } else if (ts.isPropertyAccessExpression(node) && requiredSpecifier(node.expression) !== null) {
      add(requiredSpecifier(node.expression), node.name.text);
    } else if (
      ts.isElementAccessExpression(node) &&
      requiredSpecifier(node.expression) !== null &&
      node.argumentExpression &&
      ts.isStringLiteral(node.argumentExpression)
    ) {
      add(requiredSpecifier(node.expression), node.argumentExpression.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      ((ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword)
    ) {
      add(node.arguments[0].text, ENTRYPOINT_EVIDENCE);
    } else if (
      ts.isVariableDeclaration(node) &&
      isConstDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      namespaceSpecifier(node.initializer) !== null
    ) {
      for (const element of node.name.elements) {
        if (element.dotDotDotToken) continue;
        const importedName = element.propertyName ?? element.name;
        if (ts.isIdentifier(importedName) || ts.isStringLiteral(importedName)) {
          add(namespaceSpecifier(node.initializer), importedName.text);
        }
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      isConstDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      requiredSpecifier(node.initializer) !== null
    ) {
      const specifier = requiredSpecifier(node.initializer);
      for (const element of node.name.elements) {
        if (element.dotDotDotToken) continue;
        const importedName = element.propertyName ?? element.name;
        if (ts.isIdentifier(importedName) || ts.isStringLiteral(importedName)) {
          add(specifier, importedName.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { findings, imports };
}

function collectConsumerEvidence(repoRoot, manifestUnits) {
  const publicSpecifiers = new Set(manifestUnits.map((unit) => unit.specifier));
  const evidence = new Map();
  const findings = [];
  const filesByArea = Object.fromEntries(CONSUMER_AREAS.map((area) => [area, new Set()]));
  const { files, excludedDirectories } = walkConsumerFiles(repoRoot);

  for (const file of files) {
    const parsed = consumerImports(file, publicSpecifiers, repoRoot);
    findings.push(...parsed.findings);
    const imports = parsed.imports;
    if (imports.length > 0) filesByArea[file.area].add(file.relativeFile);
    for (const imported of imports) {
      const key = `${imported.specifier}\0${imported.symbol}`;
      const current = evidence.get(key) ?? emptyConsumerEvidence();
      addEvidence(current, file.area, file.relativeFile);
      evidence.set(key, current);
    }
  }

  for (const value of evidence.values()) {
    for (const area of CONSUMER_AREAS) value[area].files.sort(compareStrings);
  }

  return {
    evidence,
    findings: [...new Set(findings)].sort(compareStrings),
    excludedDirectories,
    consumerFiles: Object.fromEntries(CONSUMER_AREAS.map((area) => [area, filesByArea[area].size])),
  };
}

function evidenceFor(evidence, specifier, symbol) {
  return evidence.get(`${specifier}\0${symbol}`) ?? emptyConsumerEvidence();
}

function entryEvidence(evidence, specifier) {
  const merged = emptyConsumerEvidence();
  for (const [key, usage] of evidence) {
    if (!key.startsWith(`${specifier}\0`)) continue;
    for (const area of CONSUMER_AREAS) {
      merged[area].imports += usage[area].imports;
      merged[area].files = [...new Set([...merged[area].files, ...usage[area].files])].sort(
        compareStrings,
      );
    }
  }
  return merged;
}

/**
 * Build a manifest-first API and consumer inventory. Wildcard-generated members remain manifest
 * units, but do not inflate the count of TypeScript entrypoints or exported declarations.
 */
export function buildPublicApiInventory(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const { findings, units } = publicManifestUnits(repoRoot);
  const entrypoints = units.filter((unit) => unit.kind === 'typescript-entrypoint');
  const generatedFamilyMembers = units.filter((unit) => unit.kind === 'generated-family-member');
  const consumer = collectConsumerEvidence(repoRoot, units);
  findings.push(...consumer.findings);
  const typescript = tsProgram(
    repoRoot,
    entrypoints.map((entry) => path.resolve(repoRoot, entry.source)),
  );
  findings.push(...typescript.diagnostics);
  const program = typescript.program;
  const checker = program.getTypeChecker();
  const declarations = [];

  for (const entry of entrypoints) {
    const absolute = path.resolve(repoRoot, entry.source);
    const sourceFile = program.getSourceFile(absolute);
    const moduleSymbol = sourceFile ? checker.getSymbolAtLocation(sourceFile) : null;
    const symbols = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
    for (const symbol of symbols) {
      const docs = documentation(symbol, checker);
      const consumers = evidenceFor(consumer.evidence, entry.specifier, symbol.name);
      declarations.push({
        package: entry.package,
        subpath: entry.subpath,
        specifier: entry.specifier,
        symbol: symbol.name,
        kind: declarationKind(symbol, checker),
        declaration: declarationInfo(symbol, checker, repoRoot),
        documented: docs.documented,
        summary: docs.summary,
        tags: docs.tags,
        type: symbolType(symbol, checker),
        consumers,
        consumerImports: totalEvidence(consumers),
      });
    }
  }

  declarations.sort((left, right) =>
    compareStrings(`${left.specifier}#${left.symbol}`, `${right.specifier}#${right.symbol}`),
  );
  const generatedFamilies = new Map();
  for (const member of generatedFamilyMembers) {
    const key = `${member.package}\0${member.exportPattern}`;
    const family = generatedFamilies.get(key) ?? {
      package: member.package,
      exportPattern: member.exportPattern,
      members: [],
    };
    family.members.push({
      subpath: member.subpath,
      specifier: member.specifier,
      source: member.source,
      consumers: entryEvidence(consumer.evidence, member.specifier),
    });
    generatedFamilies.set(key, family);
  }
  for (const family of generatedFamilies.values()) {
    family.members.sort((left, right) => compareStrings(left.specifier, right.specifier));
    family.memberCount = family.members.length;
  }

  const analyzedEntrypoints = entrypoints.map((entry) => ({
    ...entry,
    consumers: entryEvidence(consumer.evidence, entry.specifier),
  }));
  return {
    schema: PUBLIC_API_INVENTORY_SCHEMA,
    summary: {
      manifestPublicSubpaths: units.length,
      analyzedTypeScriptEntrypoints: analyzedEntrypoints.length,
      exportedDeclarations: declarations.length,
      generatedFamilyMembers: generatedFamilyMembers.length,
      consumerFiles: consumer.consumerFiles,
      excludedDirectories: consumer.excludedDirectories.length,
    },
    findings: [...new Set(findings)].sort(compareStrings),
    manifestPublicSubpaths: units,
    analyzedTypeScriptEntrypoints: analyzedEntrypoints,
    exportedDeclarations: declarations,
    generatedFamilies: [...generatedFamilies.values()].sort((left, right) =>
      compareStrings(
        `${left.package}${left.exportPattern}`,
        `${right.package}${right.exportPattern}`,
      ),
    ),
    exclusions: consumer.excludedDirectories,
  };
}

export function renderPublicApiInventoryMarkdown(inventory) {
  const { summary } = inventory;
  const lines = [
    '# Public API Inventory',
    '',
    `Schema: \`${inventory.schema}\``,
    '',
    '| Unit | Count |',
    '| --- | ---: |',
    `| Manifest-public subpaths | ${summary.manifestPublicSubpaths} |`,
    `| Analyzed TypeScript entrypoints | ${summary.analyzedTypeScriptEntrypoints} |`,
    `| Exported declarations | ${summary.exportedDeclarations} |`,
    `| Generated-family members | ${summary.generatedFamilyMembers} |`,
    '',
    '## Consumer evidence',
    '',
    '| Area | Files with public imports |',
    '| --- | ---: |',
    ...CONSUMER_AREAS.map((area) => `| ${area} | ${summary.consumerFiles[area]} |`),
    '',
    'Generated emit is reported independently and is not folded into authored examples or package',
    'internals. Excluded dependency, generated, distribution, cache, packed, and throwaway trees',
    'are listed in the JSON inventory.',
    '',
    '## TypeScript entrypoints',
    '',
    '| Entry | Declarations | Consumer imports |',
    '| --- | ---: | ---: |',
  ];

  for (const entry of inventory.analyzedTypeScriptEntrypoints) {
    const declarations = inventory.exportedDeclarations.filter(
      (item) => item.specifier === entry.specifier,
    ).length;
    lines.push(`| \`${entry.specifier}\` | ${declarations} | ${totalEvidence(entry.consumers)} |`);
  }
  lines.push('', '## Generated families', '');
  for (const family of inventory.generatedFamilies) {
    lines.push(
      `- \`${family.package}\` pattern \`${family.exportPattern}\`: ${family.memberCount} members`,
    );
  }
  if (inventory.findings.length > 0) {
    lines.push('', '## Findings', '', ...inventory.findings.map((finding) => `- ${finding}`));
  }
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const args = { check: false, json: null, markdown: null, repoRoot: defaultRepoRoot };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') args.check = true;
    else if (arg === '--json') args.json = argv[++index];
    else if (arg === '--markdown') args.markdown = argv[++index];
    else if (arg === '--repo-root') args.repoRoot = argv[++index];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/public-api-inventory.mjs [options]',
    '',
    'Options:',
    '  --json <path>       Write the versioned JSON inventory.',
    '  --markdown <path>   Write a compact Markdown report.',
    '  --check             Fail when a manifest-public subpath cannot be analyzed.',
    '  --repo-root <path>  Analyze another Kovo-shaped repository (tests/fixtures).',
    '',
  ].join('\n');
}

export function runPublicApiInventory(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage());
    return 0;
  }
  const inventory = buildPublicApiInventory({ repoRoot: args.repoRoot });
  if (args.json) writeText(args.json, `${JSON.stringify(inventory, null, 2)}\n`);
  if (args.markdown) writeText(args.markdown, renderPublicApiInventoryMarkdown(inventory));
  if (!args.json && !args.markdown) {
    process.stdout.write(`${JSON.stringify(inventory.summary, null, 2)}\n`);
  }
  if (args.check && inventory.findings.length > 0) {
    process.stderr.write(`${inventory.findings.join('\n')}\n`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = runPublicApiInventory();
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
