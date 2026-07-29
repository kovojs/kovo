#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import {
  readPackageTarballSnapshot,
  validatedPackageTarballEntries,
} from './lib/deterministic-tarball.mjs';
import { publicPackages, repoRoot as defaultRepoRoot } from './public-packages.mjs';

export const APP_PUBLIC_ANY_EXCEPTIONS_SCHEMA = 'kovo-app-public-any-exceptions/v1';

const OWNER_PATTERN = /^[a-z0-9]+(?:[-/][a-z0-9]+)*$/u;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const HASHED_DECLARATION_CHUNK = /-[A-Za-z0-9_-]{8}(?=\.d\.(?:mts|cts|ts)$)/gu;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareStrings(left, right) {
  return left.localeCompare(right);
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareStrings);
}

function wildcardReplacement(pattern, value) {
  if (pattern === value) return '';
  const first = pattern.indexOf('*');
  if (first < 0 || first !== pattern.lastIndexOf('*')) return null;
  const prefix = pattern.slice(0, first);
  const suffix = pattern.slice(first + 1);
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) return null;
  return value.slice(prefix.length, value.length - suffix.length);
}

function wildcardMatch(pattern, value) {
  return wildcardReplacement(pattern, value) !== null;
}

function replaceWildcard(value, replacement) {
  if (typeof value === 'string') return value.replaceAll('*', replacement);
  if (Array.isArray(value)) {
    return value.map((candidate) => replaceWildcard(candidate, replacement));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, candidate]) => [
        key,
        replaceWildcard(candidate, replacement),
      ]),
    );
  }
  return value;
}

function normalizeExports(exportsMap) {
  if (typeof exportsMap === 'string' || Array.isArray(exportsMap)) {
    return { '.': exportsMap };
  }
  if (!isRecord(exportsMap)) return {};
  const keys = Object.keys(exportsMap);
  if (keys.length > 0 && keys.every((key) => !key.startsWith('.'))) {
    return { '.': exportsMap };
  }
  return exportsMap;
}

function declarationTypeTarget(target) {
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) {
    for (const candidate of target) {
      const resolved = declarationTypeTarget(candidate);
      if (resolved !== null) return resolved;
    }
    return null;
  }
  if (!isRecord(target) || !Object.hasOwn(target, 'types')) return null;
  return declarationTypeTarget(target.types);
}

function resolvePackedDeclaration(exportsMap, subpath) {
  const normalized = normalizeExports(exportsMap);
  if (Object.hasOwn(normalized, subpath)) {
    return declarationTypeTarget(normalized[subpath]);
  }
  const matches = Object.entries(normalized)
    .map(([pattern, target]) => {
      const replacement = wildcardReplacement(pattern, subpath);
      if (replacement === null) return null;
      return {
        pattern,
        specificity: pattern.replace('*', '').length,
        target: declarationTypeTarget(replaceWildcard(target, replacement)),
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        right.specificity - left.specificity || compareStrings(left.pattern, right.pattern),
    );
  return matches[0]?.target ?? null;
}

function canonicalPackedTarget(target) {
  if (
    typeof target !== 'string' ||
    !target.startsWith('./') ||
    target.includes('\\') ||
    path.posix.normalize(target) !== target.slice(2)
  ) {
    return false;
  }
  return /\.d\.(?:mts|cts|ts)$/u.test(target);
}

function packageSegments(packageName) {
  if (!PACKAGE_NAME_PATTERN.test(packageName)) {
    throw new TypeError(`packed manifest has invalid package name: ${String(packageName)}`);
  }
  return packageName.split('/');
}

/**
 * Materialize only canonical, validated tar entries. The temporary node_modules tree lets the
 * compiler exercise the exact package exports and declaration graph without invoking a system tar
 * extractor or resolving first-party workspace source.
 */
export function materializePackedPackages({ tarballDir, targetRoot }) {
  if (!existsSync(tarballDir)) {
    throw new Error(`packed declaration gate: tarball directory is missing: ${tarballDir}`);
  }
  const packages = new Map();
  const tarballs = readdirSync(tarballDir)
    .filter((file) => file.endsWith('.tgz'))
    .sort(compareStrings);
  if (tarballs.length === 0) {
    throw new Error(`packed declaration gate: no .tgz files found in ${tarballDir}`);
  }

  for (const tarball of tarballs) {
    const tarballPath = path.join(tarballDir, tarball);
    const entries = validatedPackageTarballEntries(readPackageTarballSnapshot(tarballPath));
    const manifestEntry = entries.find((entry) => entry.name === 'package/package.json');
    if (!manifestEntry) throw new Error(`${tarball}: package/package.json is missing`);
    const manifest = JSON.parse(manifestEntry.data.toString('utf8'));
    const segments = packageSegments(manifest.name);
    if (packages.has(manifest.name)) {
      throw new Error(`duplicate packed package: ${manifest.name}`);
    }
    const packageRoot = path.join(targetRoot, 'node_modules', ...segments);
    for (const entry of entries) {
      if (!entry.name.startsWith('package/')) {
        throw new Error(`${tarball}: tar entry is outside package/: ${entry.name}`);
      }
      const relative = entry.name.slice('package/'.length);
      const destination = path.join(packageRoot, ...relative.split('/'));
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, entry.data, { mode: entry.executable ? 0o755 : 0o644 });
    }
    packages.set(manifest.name, { manifest, packageRoot, tarball });
  }
  return packages;
}

function linkInstalledDependencies({ packedPackages, repoRoot }) {
  const sourceDirectories = new Map(
    publicPackages().map((pkg) => [pkg.name, path.join(repoRoot, 'packages', pkg.dir)]),
  );
  for (const [packageName, packed] of packedPackages) {
    const sourceDirectory = sourceDirectories.get(packageName);
    if (!sourceDirectory) continue;
    const dependencyNames = sortedUnique(
      ['dependencies', 'peerDependencies', 'optionalDependencies'].flatMap((field) =>
        Object.keys(packed.manifest[field] ?? {}),
      ),
    );
    for (const dependencyName of dependencyNames) {
      if (packedPackages.has(dependencyName)) continue;
      const source = path.join(sourceDirectory, 'node_modules', ...dependencyName.split('/'));
      if (!existsSync(source)) continue;
      const destination = path.join(
        packed.packageRoot,
        'node_modules',
        ...dependencyName.split('/'),
      );
      mkdirSync(path.dirname(destination), { recursive: true });
      symlinkSync(path.resolve(source), destination, 'junction');
    }
  }
}

function specifierFor(packageName, subpath) {
  return subpath === '.' ? packageName : `${packageName}/${subpath.slice(2)}`;
}

function expectedDeclarationsBySpecifier(decisionLedger) {
  const expected = new Map();
  const exactRows = new Map((decisionLedger.symbols ?? []).map((row) => [row.id, row]));
  const declarationIds = new Set(decisionLedger.baseline?.declarations ?? []);
  for (const row of decisionLedger.symbols ?? []) {
    if (row.state === 'public') declarationIds.add(row.id);
  }
  for (const id of declarationIds) {
    if (exactRows.get(id)?.state === 'removed') continue;
    const separator = id.lastIndexOf('#');
    if (separator <= 0 || separator === id.length - 1) continue;
    const specifier = id.slice(0, separator);
    const symbols = expected.get(specifier) ?? [];
    symbols.push(id.slice(separator + 1));
    expected.set(specifier, symbols);
  }
  for (const symbols of expected.values()) symbols.sort(compareStrings);
  return expected;
}

function generatedFamilyFor(decisionLedger, packageName, subpath) {
  return (decisionLedger.generatedFamilies ?? []).find(
    (rule) =>
      rule.package === packageName &&
      wildcardMatch(rule.subpathPattern, subpath) &&
      wildcardMatch(rule.symbolPattern, '*'),
  );
}

function publicPackedEntries({ packedPackages, decisionLedger }) {
  const entries = [];
  const findings = [];
  for (const pkg of publicPackages()) {
    const publicSubpaths = pkg.apiBoundary?.public ?? [];
    if (publicSubpaths.length === 0) continue;
    const packed = packedPackages.get(pkg.name);
    if (!packed) {
      findings.push(`${pkg.name}: packed tarball is missing`);
      continue;
    }
    for (const subpath of publicSubpaths) {
      const specifier = specifierFor(pkg.name, subpath);
      const target = resolvePackedDeclaration(packed.manifest.exports, subpath);
      if (!canonicalPackedTarget(target)) {
        findings.push(`${specifier}: packed exports has no canonical declaration target`);
        continue;
      }
      const filePath = path.resolve(packed.packageRoot, target);
      if (
        !filePath.startsWith(`${path.resolve(packed.packageRoot)}${path.sep}`) ||
        !existsSync(filePath)
      ) {
        findings.push(`${specifier}: packed declaration target is missing: ${target}`);
        continue;
      }
      entries.push({
        package: pkg.name,
        subpath,
        specifier,
        filePath,
        generatedFamily: Boolean(generatedFamilyFor(decisionLedger, pkg.name, subpath)),
      });
    }
  }
  entries.sort((left, right) => compareStrings(left.specifier, right.specifier));
  const expectedSubpaths = new Set(decisionLedger.baseline?.subpaths ?? []);
  for (const row of decisionLedger.subpaths ?? []) {
    if (row.state === 'public') expectedSubpaths.add(row.specifier);
    else if (row.state === 'removed') expectedSubpaths.delete(row.specifier);
  }
  const actualSubpaths = entries.map((entry) => entry.specifier);
  for (const missing of [...expectedSubpaths].filter(
    (specifier) => !actualSubpaths.includes(specifier),
  )) {
    findings.push(
      `${missing}: decision-ledger subpath is absent from the packed app-public surface`,
    );
  }
  for (const added of actualSubpaths.filter((specifier) => !expectedSubpaths.has(specifier))) {
    findings.push(
      `${added}: packed app-public subpath is absent from the frozen decision baseline`,
    );
  }
  return { entries, findings: sortedUnique(findings) };
}

function diagnosticText(diagnostic, root) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (!diagnostic.file || diagnostic.start === undefined) {
    return `packed-consumer: TS${String(diagnostic.code)} ${message}`;
  }
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const relative = path.relative(root, diagnostic.file.fileName).split(path.sep).join('/');
  return `${relative}:${String(position.line + 1)}:${String(position.character + 1)} TS${String(
    diagnostic.code,
  )} ${message}`;
}

function createPackedProgram({ entries, targetRoot }) {
  const consumerPath = path.join(targetRoot, 'app-public-consumer.mts');
  const consumer = entries
    .map(
      (entry, index) =>
        `export type PublicModule${String(index)} = typeof import(${JSON.stringify(entry.specifier)});`,
    )
    .join('\n');
  writeFileSync(consumerPath, `${consumer}\n`);
  const options = {
    allowJs: false,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    resolveJsonModule: true,
    // This gate owns Kovo's package-entry resolution, exact export shape, and AST. Third-party
    // declaration health is version-specific peer debt and is checked by the dependency owners.
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: ['node'],
  };
  const program = ts.createProgram([consumerPath], options);
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => diagnosticText(diagnostic, targetRoot));
  return { program, diagnostics: sortedUnique(diagnostics) };
}

function resolveAlias(symbol, checker) {
  let current = symbol;
  const seen = new Set();
  while (current.flags & ts.SymbolFlags.Alias) {
    if (seen.has(current)) break;
    seen.add(current);
    const resolved = checker.getAliasedSymbol(current);
    if (!resolved || resolved === current) break;
    current = resolved;
  }
  return current;
}

function normalizedFileName(fileName) {
  return path.resolve(fileName).split(path.sep).join('/');
}

function owningPackage(fileName, firstPartyRoots) {
  const normalized = normalizedFileName(fileName);
  return firstPartyRoots.find(({ root }) => {
    const normalizedRoot = normalizedFileName(root);
    return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
  });
}

function normalizedDeclarationPath(fileName, owner) {
  const relative = path
    .relative(owner.root, fileName)
    .split(path.sep)
    .join('/')
    .replace(HASHED_DECLARATION_CHUNK, '-<chunk>');
  return `${owner.package}/${
    relative.startsWith('dist/') ? relative : `dist/${relative.replace(/^dist\//u, '')}`
  }`;
}

function symbolAtReference(node, checker) {
  let location = null;
  if (ts.isTypeReferenceNode(node)) location = node.typeName;
  else if (ts.isExpressionWithTypeArguments(node)) location = node.expression;
  else if (ts.isImportTypeNode(node)) location = node.qualifier;
  else if (ts.isTypeQueryNode(node)) location = node.exprName;
  if (!location) return null;
  const symbol = checker.getSymbolAtLocation(location);
  return symbol ? resolveAlias(symbol, checker) : null;
}

function nodeName(node) {
  if (!node.name) return null;
  if (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name)) return node.name.text;
  if (ts.isStringLiteralLike(node.name) || ts.isNumericLiteral(node.name)) {
    return node.name.text;
  }
  return node.name.getText();
}

function containingMember(anyNode, declaration, fallback) {
  for (let current = anyNode.parent; current && current !== declaration; current = current.parent) {
    const name = nodeName(current);
    if (name === null) continue;
    if (ts.isParameter(current)) return `parameter:${name}`;
    if (ts.isTypeParameterDeclaration(current)) return `type-parameter:${name}`;
    if (
      ts.isPropertySignature(current) ||
      ts.isPropertyDeclaration(current) ||
      ts.isMethodSignature(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current)
    ) {
      return name;
    }
  }
  return fallback;
}

function scanSymbolDeclaration({
  symbol,
  trace,
  checker,
  firstPartyRoots,
  findingsByLocation,
  references,
}) {
  const declarations = symbol.declarations ?? [];
  for (const declaration of declarations) {
    const sourceFile = declaration.getSourceFile();
    const owner = owningPackage(sourceFile.fileName, firstPartyRoots);
    if (!owner) continue;

    function visit(node) {
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const location = `${normalizedFileName(sourceFile.fileName)}:${String(node.getStart())}`;
        if (!findingsByLocation.has(location)) {
          findingsByLocation.set(location, {
            package: owner.package,
            declaration: normalizedDeclarationPath(sourceFile.fileName, owner),
            line: position.line + 1,
            column: position.character + 1,
            symbol: symbol.name,
            member: containingMember(node, declaration, symbol.name),
            aliasPath: trace.join(' -> '),
          });
        }
      }
      const referenced = symbolAtReference(node, checker);
      if (referenced && referenced !== symbol) references.add(referenced);
      ts.forEachChild(node, visit);
    }

    visit(declaration);
  }
}

/**
 * Walk the declaration graph from every app-public module export. Explicit `any` nodes are found
 * with the TypeScript AST, and first-party aliases/type references are recursively unwrapped.
 * Third-party declaration internals are deliberately outside Kovo's ownership boundary.
 */
export function analyzeAppPublicAny({ program, entries, firstPartyRoots }) {
  const checker = program.getTypeChecker();
  const queue = [];
  for (const entry of entries) {
    const sourceFile = program.getSourceFile(entry.filePath);
    if (!sourceFile) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;
    const exports = checker
      .getExportsOfModule(moduleSymbol)
      .sort((left, right) => compareStrings(left.name, right.name));
    for (const symbol of exports) {
      queue.push({
        symbol: resolveAlias(symbol, checker),
        trace: [`${entry.specifier}#${symbol.name}`],
      });
    }
  }

  const seen = new Set();
  const findingsByLocation = new Map();
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current.symbol)) continue;
    seen.add(current.symbol);
    if (
      !(current.symbol.declarations ?? []).some((declaration) =>
        owningPackage(declaration.getSourceFile().fileName, firstPartyRoots),
      )
    ) {
      continue;
    }
    const references = new Set();
    scanSymbolDeclaration({
      symbol: current.symbol,
      trace: current.trace,
      checker,
      firstPartyRoots,
      findingsByLocation,
      references,
    });
    for (const referenced of references) {
      queue.push({
        symbol: referenced,
        trace: [...current.trace, referenced.name],
      });
    }
  }
  return [...findingsByLocation.values()].sort(
    (left, right) =>
      compareStrings(left.declaration, right.declaration) ||
      left.line - right.line ||
      left.column - right.column,
  );
}

function validateExceptionPattern(findings, label, pattern) {
  if (
    typeof pattern !== 'string' ||
    pattern.length === 0 ||
    pattern.indexOf('*') !== pattern.lastIndexOf('*')
  ) {
    findings.push(`${label} must be a non-empty exact or single-wildcard pattern`);
  }
}

function parseUtcDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

/**
 * Apply a descending, exact-count exception ratchet. A fixed `any` makes the exception stale, and
 * a new `any` cannot consume spare budget because every exception's match count is exact.
 */
export function applyAnyExceptions(
  anyFindings,
  config,
  { today = new Date().toISOString().slice(0, 10) } = {},
) {
  const findings = [];
  if (!isRecord(config) || config.schema !== APP_PUBLIC_ANY_EXCEPTIONS_SCHEMA) {
    return {
      findings: [
        `api-public-any-exceptions.json: schema must be ${APP_PUBLIC_ANY_EXCEPTIONS_SCHEMA}`,
      ],
      approved: 0,
      unapproved: anyFindings,
    };
  }
  const exceptions = Array.isArray(config.exceptions) ? config.exceptions : [];
  const ids = new Set();
  const validExceptions = [];
  const todayDate = parseUtcDate(today);
  if (!todayDate) findings.push(`today must be an ISO UTC date, got ${String(today)}`);

  for (const [index, exception] of exceptions.entries()) {
    const label = `exceptions[${String(index)}]`;
    if (!isRecord(exception)) {
      findings.push(`${label} must be an object`);
      continue;
    }
    if (
      typeof exception.id !== 'string' ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(exception.id) ||
      ids.has(exception.id)
    ) {
      findings.push(`${label}.id must be unique kebab-case`);
    }
    ids.add(exception.id);
    if (
      typeof exception.package !== 'string' ||
      !exception.package.startsWith('@kovojs/') ||
      exception.package.includes('*')
    ) {
      findings.push(`${label}.package must be one exact @kovojs package`);
    }
    validateExceptionPattern(findings, `${label}.declarationPattern`, exception.declarationPattern);
    validateExceptionPattern(findings, `${label}.symbolPattern`, exception.symbolPattern);
    validateExceptionPattern(findings, `${label}.memberPattern`, exception.memberPattern);
    if (
      typeof exception.declarationPattern === 'string' &&
      !exception.declarationPattern.startsWith(`${exception.package}/dist/`)
    ) {
      findings.push(`${label}.declarationPattern must stay inside ${exception.package}/dist/`);
    }
    if (
      exception.declarationPattern?.includes('*') &&
      exception.symbolPattern === '*' &&
      exception.memberPattern === '*'
    ) {
      findings.push(
        `${label} may wildcard declaration files only when symbolPattern or memberPattern is narrow`,
      );
    }
    if (!Number.isInteger(exception.maximumMatches) || exception.maximumMatches < 1) {
      findings.push(`${label}.maximumMatches must be a positive integer`);
    }
    if (typeof exception.owner !== 'string' || !OWNER_PATTERN.test(exception.owner)) {
      findings.push(`${label}.owner must be a stable lowercase team/area identifier`);
    }
    if (typeof exception.reason !== 'string' || exception.reason.trim().length < 40) {
      findings.push(`${label}.reason must explain the concrete remaining type debt`);
    }
    const expiry = parseUtcDate(exception.expires);
    if (!expiry) {
      findings.push(`${label}.expires must be an ISO UTC date`);
    } else if (todayDate && expiry <= todayDate) {
      findings.push(`${label} expired on ${exception.expires}`);
    }
    validExceptions.push(exception);
  }

  const matchCounts = new Map(validExceptions.map((exception) => [exception.id, 0]));
  const unapproved = [];
  for (const anyFinding of anyFindings) {
    const matches = validExceptions.filter(
      (exception) =>
        exception.package === anyFinding.package &&
        wildcardMatch(exception.declarationPattern, anyFinding.declaration) &&
        wildcardMatch(exception.symbolPattern, anyFinding.symbol) &&
        wildcardMatch(exception.memberPattern, anyFinding.member),
    );
    if (matches.length === 0) {
      unapproved.push(anyFinding);
      continue;
    }
    if (matches.length > 1) {
      findings.push(
        `${anyFinding.declaration}:${String(anyFinding.line)}:${String(
          anyFinding.column,
        )} matches overlapping exceptions ${matches.map((entry) => entry.id).join(', ')}`,
      );
      continue;
    }
    matchCounts.set(matches[0].id, (matchCounts.get(matches[0].id) ?? 0) + 1);
  }

  for (const exception of validExceptions) {
    const count = matchCounts.get(exception.id) ?? 0;
    if (count !== exception.maximumMatches) {
      findings.push(
        `exception ${exception.id} match count is ${String(count)}, expected exact descending maximum ${String(
          exception.maximumMatches,
        )}`,
      );
    }
  }
  for (const finding of unapproved) {
    findings.push(
      `${finding.declaration}:${String(finding.line)}:${String(
        finding.column,
      )} ${finding.symbol}.${finding.member} exposes any via ${finding.aliasPath}`,
    );
  }
  return {
    findings: sortedUnique(findings),
    approved: anyFindings.length - unapproved.length,
    unapproved,
    matchCounts: Object.fromEntries(matchCounts),
  };
}

function packedExportFindings({ program, entries, decisionLedger }) {
  const checker = program.getTypeChecker();
  const expected = expectedDeclarationsBySpecifier(decisionLedger);
  const findings = [];
  for (const entry of entries) {
    const sourceFile = program.getSourceFile(entry.filePath);
    if (!sourceFile) {
      findings.push(`${entry.specifier}: declaration was not loaded by the packed consumer`);
      continue;
    }
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) {
      findings.push(`${entry.specifier}: declaration has no module symbol`);
      continue;
    }
    const actualSymbols = checker
      .getExportsOfModule(moduleSymbol)
      .map((symbol) => symbol.name)
      .sort(compareStrings);
    const expectedSymbols = expected.get(entry.specifier) ?? [];
    if (entry.generatedFamily && expectedSymbols.length === 0) {
      if (actualSymbols.length === 0) {
        findings.push(`${entry.specifier}: generated family member exports no declaration`);
      }
      continue;
    }
    for (const missing of expectedSymbols.filter((symbol) => !actualSymbols.includes(symbol))) {
      findings.push(`${entry.specifier}#${missing}: missing from packed declarations`);
    }
    for (const added of actualSymbols.filter((symbol) => !expectedSymbols.includes(symbol))) {
      findings.push(`${entry.specifier}#${added}: packed-only export lacks a decision-ledger row`);
    }
  }
  return sortedUnique(findings);
}

export function runPackedPublicAnyGate({
  repoRoot = defaultRepoRoot,
  tarballDir = path.join(repoRoot, '.release', 'tarballs'),
  exceptionsPath = path.join(repoRoot, 'api-public-any-exceptions.json'),
  decisionsPath = path.join(repoRoot, 'api-surface-decisions.json'),
  today,
} = {}) {
  const decisionLedger = JSON.parse(readFileSync(decisionsPath, 'utf8'));
  const exceptions = JSON.parse(readFileSync(exceptionsPath, 'utf8'));
  const targetRoot = mkdtempSync(path.join(repoRoot, '.packed-public-api-'));
  try {
    const packedPackages = materializePackedPackages({ tarballDir, targetRoot });
    linkInstalledDependencies({ packedPackages, repoRoot });
    const publicSurface = publicPackedEntries({ packedPackages, decisionLedger });
    const compiled = createPackedProgram({ entries: publicSurface.entries, targetRoot });
    const exportFindings = packedExportFindings({
      program: compiled.program,
      entries: publicSurface.entries,
      decisionLedger,
    });
    const firstPartyRoots = [...packedPackages.entries()].map(([packageName, packed]) => ({
      package: packageName,
      root: packed.packageRoot,
    }));
    const anyFindings = analyzeAppPublicAny({
      program: compiled.program,
      entries: publicSurface.entries,
      firstPartyRoots,
    });
    const exceptionResult = applyAnyExceptions(anyFindings, exceptions, { today });
    const findings = sortedUnique([
      ...publicSurface.findings,
      ...compiled.diagnostics,
      ...exportFindings,
      ...exceptionResult.findings,
    ]);
    const report = {
      packages: packedPackages.size,
      subpaths: publicSurface.entries.length,
      declarations: [...expectedDeclarationsBySpecifier(decisionLedger).values()].reduce(
        (total, symbols) => total + symbols.length,
        0,
      ),
      any: anyFindings.length,
      approvedAny: exceptionResult.approved,
      anyByPackage: Object.fromEntries(
        [...new Set(anyFindings.map((finding) => finding.package))]
          .sort(compareStrings)
          .map((packageName) => [
            packageName,
            anyFindings.filter((finding) => finding.package === packageName).length,
          ]),
      ),
    };
    if (findings.length > 0) {
      process.stderr.write(
        `packed-public-any-gate: ${String(findings.length)} finding(s):\n  ${findings.join(
          '\n  ',
        )}\n`,
      );
      return { ok: false, findings, anyFindings, report };
    }
    process.stdout.write(
      `packed-public-any/v1 packages=${String(report.packages)} app-public-subpaths=${String(
        report.subpaths,
      )} ledger-declarations=${String(report.declarations)} explicit-any=${String(
        report.any,
      )} approved=${String(report.approvedAny)}\n`,
    );
    process.stdout.write(
      `packed-public-any/packages ${Object.entries(report.anyByPackage)
        .map(([packageName, count]) => `${packageName}=${String(count)}`)
        .join(' ')}\n`,
    );
    return { ok: true, findings, anyFindings, report };
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--tarball-dir') args.tarballDir = path.resolve(argv[++index]);
    else if (arg === '--exceptions') args.exceptionsPath = path.resolve(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = runPackedPublicAnyGate(parseArgs(process.argv.slice(2)));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
