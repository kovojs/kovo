#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { collectFiles } from './lib/source-files.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();

export const postgresRlsEmitterFile =
  'packages/server/src/postgres-authorization-correspondence.ts';
export const postgresRlsRuntimeFile = 'packages/server/src/postgres-runtime.ts';
export const postgresRlsEmissionSites = Object.freeze([
  'owner',
  'ownerVia',
  'authzPolicy',
  'system',
  'admin',
]);

const emitterName = 'emitPostgresRlsPolicySql';
const primaryEmitterName = 'primaryPolicySql';
const productionSourcePattern = /(?:\.[cm]?[jt]sx?|\.sql)$/u;
const productionTestPattern = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const expectedCreateRenderers = Object.freeze([
  `${emitterName}\u0000CREATE POLICY kovo_admin_scope ON `,
  `${emitterName}\u0000CREATE POLICY kovo_system_scope ON `,
  `${primaryEmitterName}\u0000CREATE POLICY `,
]);
const expectedDropRenderers = Object.freeze([
  'applyPostgresRlsPolicies\u0000DROP POLICY IF EXISTS kovo_admin_scope ON ',
  'applyPostgresRlsPolicies\u0000DROP POLICY IF EXISTS kovo_authz_policy ON ',
  'applyPostgresRlsPolicies\u0000DROP POLICY IF EXISTS kovo_owner_scope ON ',
  'applyPostgresRlsPolicies\u0000DROP POLICY IF EXISTS kovo_system_scope ON ',
]);
const expectedPrimaryCases = Object.freeze(['authzPolicy', 'owner', 'ownerVia']);

export function collectPostgresRlsProductionFiles(rootDir = repoRoot) {
  const packageRoot = path.join(rootDir, 'packages');
  const roots = [];
  for (const entry of readdirSync(packageRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sourceRoot = `packages/${entry.name}/src`;
    if (existsSync(path.join(rootDir, sourceRoot))) roots.push(sourceRoot);
  }
  const starterRoot = 'packages/create-kovo/templates';
  if (existsSync(path.join(rootDir, starterRoot))) roots.push(starterRoot);
  return collectFiles(rootDir, roots, {
    includeFile: ({ relativePath }) => isProductionPackageSource(relativePath),
  });
}

export function loadPostgresRlsEmissionDoorInput({ rootDir = repoRoot } = {}) {
  const files = new Map();
  for (const fileName of collectPostgresRlsProductionFiles(rootDir)) {
    files.set(fileName, readFileSync(path.join(rootDir, fileName), 'utf8'));
  }
  return files;
}

export function checkPostgresRlsEmissionDoor({ files, rootDir = repoRoot } = {}) {
  const sources = normalizeSources(files ?? loadPostgresRlsEmissionDoorInput({ rootDir }));
  const findings = [];
  const parsed = new Map();

  for (const [fileName, source] of sources) {
    if (fileName.endsWith('.sql')) {
      const policyMutation = postgresPolicyMutationKeyword(source);
      if (policyMutation !== undefined) {
        findings.push(
          `${fileName}:1: raw ${policyMutation} POLICY SQL is outside the sole reviewed renderer ${postgresRlsEmitterFile}`,
        );
      }
      continue;
    }
    parsed.set(fileName, parseSource(fileName, source));
  }

  const program = createSourceProgram(parsed);
  const checker = program.getTypeChecker();
  for (const fileName of parsed.keys()) {
    const boundSource = program.getSourceFile(fileName);
    if (boundSource !== undefined) parsed.set(fileName, boundSource);
  }

  const emitterSource = parsed.get(postgresRlsEmitterFile);
  if (emitterSource === undefined) {
    findings.push(`${postgresRlsEmitterFile}: reviewed Postgres RLS SQL emitter is missing`);
  } else {
    validateEmitterInventory(emitterSource, findings);
    validateEmitterSwitch(emitterSource, findings);
    validatePrimaryEmitterCalls(emitterSource, checker, findings);
    validateRendererSymbolClosure(program, emitterSource, checker, findings, rootDir);
  }

  const createRenderers = [];
  const dropRenderers = [];
  const runtimeCalls = [];
  let runtimeEmitterImports = 0;
  for (const [fileName, sourceFile] of parsed) {
    collectRawPolicyRenderers(
      sourceFile,
      checker,
      fileName,
      createRenderers,
      dropRenderers,
      findings,
    );
    collectEmitterModuleEscapes(sourceFile, checker, fileName, findings, rootDir);
    const bindings = collectEmitterImportBindings(sourceFile, fileName, findings, rootDir);
    if (fileName === postgresRlsRuntimeFile) runtimeEmitterImports = bindings.importCount;
    collectEmitterCalls(sourceFile, fileName, bindings, runtimeCalls, findings);
    collectEmitterBindingEscapes(sourceFile, fileName, bindings, findings);
  }

  validateRawRenderers(createRenderers, dropRenderers, findings);
  validateRuntimeCalls(runtimeCalls, findings);
  if (runtimeEmitterImports !== 1) {
    findings.push(
      `${postgresRlsRuntimeFile}: expected exactly one direct ${emitterName} import, found ${runtimeEmitterImports}`,
    );
  }

  return {
    findings,
    ok: findings.length === 0,
    createRendererCount: createRenderers.length,
    dropRendererCount: dropRenderers.length,
    rawRendererCount: createRenderers.length,
    runtimeCallCount: runtimeCalls.length,
    siteCount: postgresRlsEmissionSites.length,
    summary:
      findings.length === 0
        ? `OK ${postgresRlsEmissionSites.length} Postgres RLS emission sites, ${createRenderers.length} CREATE renderers, ${dropRenderers.length} DROP renderers, ${runtimeCalls.length} runtime constructor calls`
        : `${findings.length} Postgres RLS emission-door violation(s)`,
  };
}

export function main(options = {}) {
  const result = checkPostgresRlsEmissionDoor(options);
  process.stdout.write(`check-postgres-rls-emission-door/v1 ${result.summary}\n`);
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

function normalizeSources(files) {
  const entries = files instanceof Map ? [...files] : Object.entries(files);
  return new Map(
    entries
      .filter(([fileName]) => isProductionPackageSource(fileName))
      .map(([fileName, source]) => [slash(fileName), String(source)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function isProductionPackageSource(fileName) {
  const normalized = slash(fileName);
  return (
    (/^packages\/[^/]+\/src\//u.test(normalized) ||
      normalized.startsWith('packages/create-kovo/templates/')) &&
    productionSourcePattern.test(normalized) &&
    !normalized.endsWith('.d.ts') &&
    !productionTestPattern.test(normalized)
  );
}

function parseSource(fileName, source) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind(fileName));
}

function scriptKind(fileName) {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/u.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function createSourceProgram(sources) {
  const compilerOptions = {
    allowJs: true,
    checkJs: false,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noLib: true,
    target: ts.ScriptTarget.Latest,
  };
  const sourceByName = new Map(
    [...sources].map(([fileName, sourceFile]) => [slash(fileName), sourceFile]),
  );
  const host = {
    directoryExists: () => true,
    fileExists: (fileName) => sourceByName.has(slash(fileName)),
    getCanonicalFileName: (fileName) => slash(fileName),
    getCurrentDirectory: () => '',
    getDefaultLibFileName: () => 'lib.d.ts',
    getDirectories: () => [],
    getNewLine: () => '\n',
    getSourceFile: (fileName) => sourceByName.get(slash(fileName)),
    readFile: (fileName) => sourceByName.get(slash(fileName))?.text,
    resolveModuleNames: (moduleNames, containingFile) =>
      moduleNames.map((specifier) => resolveSourceModule(sourceByName, containingFile, specifier)),
    useCaseSensitiveFileNames: () => true,
    writeFile: () => undefined,
  };
  return ts.createProgram({
    host,
    options: compilerOptions,
    rootNames: [...sourceByName.keys()],
  });
}

function resolveSourceModule(sources, containingFile, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  const unresolved = slash(
    path.posix.normalize(path.posix.join(path.posix.dirname(containingFile), specifier)),
  );
  const candidates = sourceResolutionCandidates(unresolved);
  const resolvedFileName = candidates.find((candidate) => sources.has(candidate));
  if (resolvedFileName === undefined) return undefined;
  return {
    extension: typescriptExtension(resolvedFileName),
    isExternalLibraryImport: false,
    resolvedFileName,
  };
}

function typescriptExtension(fileName) {
  if (fileName.endsWith('.tsx')) return ts.Extension.Tsx;
  if (fileName.endsWith('.mts')) return ts.Extension.Mts;
  if (fileName.endsWith('.cts')) return ts.Extension.Cts;
  if (fileName.endsWith('.jsx')) return ts.Extension.Jsx;
  if (fileName.endsWith('.mjs')) return ts.Extension.Mjs;
  if (fileName.endsWith('.cjs')) return ts.Extension.Cjs;
  if (fileName.endsWith('.js')) return ts.Extension.Js;
  return ts.Extension.Ts;
}

function sameSymbol(checker, left, right) {
  if (left === undefined || right === undefined) return false;
  return resolveAlias(checker, left) === resolveAlias(checker, right);
}

function resolveAlias(checker, symbol) {
  let current = symbol;
  const seen = new Set();
  while ((current.flags & ts.SymbolFlags.Alias) !== 0 && !seen.has(current)) {
    seen.add(current);
    const target = checker.getAliasedSymbol(current);
    if (target === current) break;
    current = target;
  }
  return current;
}

function validateEmitterInventory(sourceFile, findings) {
  let inventory;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      if (declaration.name.text !== 'POSTGRES_RLS_SQL_EMISSION_SITES') continue;
      inventory = arrayInitializer(declaration.initializer);
    }
  }
  if (inventory === undefined) {
    findings.push(
      `${postgresRlsEmitterFile}: POSTGRES_RLS_SQL_EMISSION_SITES must be one frozen literal array`,
    );
    return;
  }
  const sites = inventory.elements.map((element) =>
    ts.isStringLiteralLike(element) ? element.text : '<non-literal>',
  );
  if (!equalArrays(sites, postgresRlsEmissionSites)) {
    findings.push(
      `${postgresRlsEmitterFile}: emission inventory must be exactly [${postgresRlsEmissionSites.join(', ')}], found [${sites.join(', ')}]`,
    );
  }
}

function arrayInitializer(initializer) {
  let current = unwrapExpression(initializer);
  if (
    ts.isCallExpression(current) &&
    ts.isPropertyAccessExpression(current.expression) &&
    ts.isIdentifier(current.expression.expression) &&
    current.expression.expression.text === 'Object' &&
    current.expression.name.text === 'freeze' &&
    current.arguments.length === 1
  ) {
    current = unwrapExpression(current.arguments[0]);
  }
  return ts.isArrayLiteralExpression(current) ? current : undefined;
}

function validateEmitterSwitch(sourceFile, findings) {
  const declaration = findFunctionDeclaration(sourceFile, emitterName);
  if (declaration?.body === undefined) {
    findings.push(`${postgresRlsEmitterFile}: ${emitterName}() declaration is missing`);
    return;
  }
  const switches = [];
  walk(declaration.body, (node) => {
    if (ts.isSwitchStatement(node)) switches.push(node);
  });
  if (switches.length !== 1) {
    findings.push(
      `${postgresRlsEmitterFile}: ${emitterName}() must contain exactly one closed site switch, found ${switches.length}`,
    );
    return;
  }
  const clauses = switches[0].caseBlock.clauses;
  const cases = clauses
    .filter(ts.isCaseClause)
    .map((clause) => (ts.isStringLiteralLike(clause.expression) ? clause.expression.text : '?'));
  const defaultCount = clauses.filter(ts.isDefaultClause).length;
  if (!equalArrays(cases, postgresRlsEmissionSites) || defaultCount !== 1) {
    findings.push(
      `${postgresRlsEmitterFile}: ${emitterName}() cases must be exactly [${postgresRlsEmissionSites.join(', ')}] plus one default; found [${cases.join(', ')}] plus ${defaultCount} default`,
    );
  }
}

function validatePrimaryEmitterCalls(sourceFile, checker, findings) {
  const declaration = findFunctionDeclaration(sourceFile, primaryEmitterName);
  const target =
    declaration?.name === undefined ? undefined : checker.getSymbolAtLocation(declaration.name);
  const calls = [];
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (!ts.isIdentifier(node.expression)) return;
    if (!sameSymbol(checker, checker.getSymbolAtLocation(node.expression), target)) return;
    calls.push(enclosingCaseName(node));
  });
  calls.sort((left, right) => left.localeCompare(right));
  if (!equalArrays(calls, expectedPrimaryCases)) {
    findings.push(
      `${postgresRlsEmitterFile}: ${primaryEmitterName}() must be called only by owner, ownerVia, and authzPolicy; found [${calls.join(', ')}]`,
    );
  }
}

function validateRendererSymbolClosure(program, sourceFile, checker, findings, rootDir) {
  const publicDeclaration = findFunctionDeclaration(sourceFile, emitterName);
  const declaration = findFunctionDeclaration(sourceFile, primaryEmitterName);
  const publicTarget =
    publicDeclaration?.name === undefined
      ? undefined
      : checker.getSymbolAtLocation(publicDeclaration.name);
  const target =
    declaration?.name === undefined ? undefined : checker.getSymbolAtLocation(declaration.name);
  if (
    publicDeclaration?.name === undefined ||
    publicTarget === undefined ||
    declaration?.name === undefined ||
    target === undefined
  ) {
    findings.push(
      `${postgresRlsEmitterFile}: reviewed public/private RLS renderer declarations are missing`,
    );
    return;
  }

  for (const candidate of program.getSourceFiles()) {
    const fileName = slash(candidate.fileName);
    walk(candidate, (node) => {
      if (!ts.isIdentifier(node)) return;
      const symbol = checker.getSymbolAtLocation(node);
      if (sameSymbol(checker, symbol, target)) {
        if (node === declaration.name) return;
        if (ts.isCallExpression(node.parent) && node.parent.expression === node) return;
        findings.push(
          `${fileName}:${lineOf(candidate, node)}: private ${primaryEmitterName} may not be aliased, exported, returned, or otherwise escape its three reviewed direct call positions`,
        );
        return;
      }
      if (!sameSymbol(checker, symbol, publicTarget)) return;
      if (node === publicDeclaration.name) return;
      if (isReviewedRuntimeEmitterReference(node, candidate, fileName, rootDir)) return;
      findings.push(
        `${fileName}:${lineOf(candidate, node)}: ${emitterName} may appear only in its declaration, the reviewed runtime import, and the five direct runtime calls`,
      );
    });
  }
}

function isReviewedRuntimeEmitterReference(node, sourceFile, fileName, rootDir) {
  if (fileName !== postgresRlsRuntimeFile || node.text !== emitterName) return false;
  if (
    ts.isImportSpecifier(node.parent) &&
    node.parent.name === node &&
    node.parent.propertyName === undefined
  ) {
    const declaration = node.parent.parent.parent.parent;
    return (
      ts.isImportDeclaration(declaration) &&
      ts.isStringLiteral(declaration.moduleSpecifier) &&
      moduleCanResolveToEmitter(fileName, declaration.moduleSpecifier.text, rootDir)
    );
  }
  return ts.isCallExpression(node.parent) && node.parent.expression === node;
}

function collectRawPolicyRenderers(sourceFile, checker, fileName, createRows, dropRows, findings) {
  walk(sourceFile, (node) => {
    if (isStringToken(node)) {
      const policyMutation = postgresPolicyMutationKeyword(node.text);
      if (policyMutation === 'CREATE') {
        createRows.push({
          fileName,
          functionName: enclosingFunctionName(node) ?? '<module>',
          line: lineOf(sourceFile, node),
          text: node.text,
        });
      } else if (policyMutation === 'DROP') {
        dropRows.push({
          fileName,
          functionName: enclosingFunctionName(node) ?? '<module>',
          line: lineOf(sourceFile, node),
          text: node.text,
        });
      } else if (policyMutation !== undefined) {
        findings.push(
          `${fileName}:${lineOf(sourceFile, node)}: raw ${policyMutation} POLICY SQL is outside the sole reviewed renderer ${postgresRlsEmitterFile}`,
        );
      }
    }
    if (!isStaticStringComposition(node)) return;
    const value = evaluateStaticString(node, checker);
    const policyMutation = value === undefined ? undefined : postgresPolicyMutationKeyword(value);
    if (policyMutation === undefined) return;
    if (containsDirectPolicyMutationLiteral(node)) return;
    const parentValue = isStaticStringComposition(node.parent)
      ? evaluateStaticString(node.parent, checker)
      : undefined;
    if (parentValue !== undefined && postgresPolicyMutationKeyword(parentValue) !== undefined)
      return;
    findings.push(
      `${fileName}:${lineOf(sourceFile, node)}: statically concatenated ${policyMutation} POLICY SQL is outside the sole reviewed renderer`,
    );
  });
}

function validateRawRenderers(createRows, dropRows, findings) {
  for (const row of createRows) {
    if (row.fileName !== postgresRlsEmitterFile) {
      findings.push(
        `${row.fileName}:${row.line}: raw CREATE POLICY SQL is outside the sole reviewed renderer ${postgresRlsEmitterFile}`,
      );
    }
  }
  const centralRows = createRows
    .filter((row) => row.fileName === postgresRlsEmitterFile)
    .map((row) => `${row.functionName}\u0000${row.text}`)
    .sort((left, right) => left.localeCompare(right));
  if (!equalArrays(centralRows, expectedCreateRenderers)) {
    findings.push(
      `${postgresRlsEmitterFile}: expected exactly three reviewed CREATE POLICY renderers owned by ${emitterName}()/` +
        `${primaryEmitterName}(), found ${centralRows.length}`,
    );
  }
  for (const row of dropRows) {
    if (row.fileName !== postgresRlsRuntimeFile) {
      findings.push(
        `${row.fileName}:${row.line}: raw DROP POLICY SQL is outside the sole reviewed runtime policy reset ${postgresRlsRuntimeFile}`,
      );
    }
  }
  const runtimeDropRows = dropRows
    .filter((row) => row.fileName === postgresRlsRuntimeFile)
    .map((row) => `${row.functionName}\u0000${row.text}`)
    .sort((left, right) => left.localeCompare(right));
  if (!equalArrays(runtimeDropRows, expectedDropRenderers)) {
    findings.push(
      `${postgresRlsRuntimeFile}: expected exactly four reviewed DROP POLICY resets owned by applyPostgresRlsPolicies(), found ${runtimeDropRows.length}`,
    );
  }
}

function collectEmitterImportBindings(sourceFile, fileName, findings, rootDir) {
  const localNames = new Set();
  let importCount = 0;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (!moduleCanResolveToEmitter(fileName, statement.moduleSpecifier.text, rootDir)) continue;
    const clause = statement.importClause;
    if (
      clause === undefined ||
      clause.name !== undefined ||
      clause.namedBindings === undefined ||
      !ts.isNamedImports(clause.namedBindings)
    ) {
      findings.push(
        `${fileName}:${lineOf(sourceFile, statement)}: the RLS correspondence module may be accessed only through reviewed named imports`,
      );
      continue;
    }
    for (const element of clause.namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === primaryEmitterName) {
        findings.push(
          `${fileName}:${lineOf(sourceFile, element)}: private ${primaryEmitterName} may not be imported`,
        );
      }
      if (importedName !== emitterName) continue;
      importCount += 1;
      localNames.add(element.name.text);
      if (fileName !== postgresRlsRuntimeFile) {
        findings.push(
          `${fileName}:${lineOf(sourceFile, element)}: ${emitterName} may be imported only by ${postgresRlsRuntimeFile}`,
        );
      } else if (element.name.text !== emitterName) {
        findings.push(
          `${fileName}:${lineOf(sourceFile, element)}: ${emitterName} must not be aliased`,
        );
      }
    }
  }
  return { importCount, localNames };
}

function collectEmitterModuleEscapes(sourceFile, checker, fileName, findings, rootDir) {
  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      moduleCanResolveToEmitter(fileName, statement.moduleSpecifier.text, rootDir)
    ) {
      findings.push(
        `${fileName}:${lineOf(sourceFile, statement)}: the RLS correspondence module must not be re-exported through a barrel`,
      );
    }
    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression !== undefined &&
      ts.isStringLiteral(statement.moduleReference.expression) &&
      moduleCanResolveToEmitter(fileName, statement.moduleReference.expression.text, rootDir)
    ) {
      findings.push(
        `${fileName}:${lineOf(sourceFile, statement)}: the RLS correspondence module may not be imported through import-equals`,
      );
    }
  }

  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return;
    const argument = node.arguments?.[0];
    if (argument === undefined) return;
    const specifier = evaluateStaticString(argument, checker);
    if (specifier === undefined || !moduleCanResolveToEmitter(fileName, specifier, rootDir)) return;
    findings.push(
      `${fileName}:${lineOf(sourceFile, node)}: the RLS correspondence module may not be supplied to runtime loading code`,
    );
  });

  walk(sourceFile, (node) => {
    if (!ts.isStringLiteral(node) || !moduleCanResolveToEmitter(fileName, node.text, rootDir)) {
      return;
    }
    const parent = node.parent;
    if (
      (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
      parent.moduleSpecifier === node
    ) {
      return;
    }
    if (ts.isExternalModuleReference(parent) && parent.expression === node) return;
    if (
      (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
      parent.arguments?.[0] === node
    ) {
      return;
    }
    findings.push(
      `${fileName}:${lineOf(sourceFile, node)}: the RLS correspondence module specifier may not escape into computed loading data`,
    );
  });
}

function moduleCanResolveToEmitter(fileName, specifier, rootDir) {
  if (!specifier.startsWith('.')) return false;
  const emitterIdentity = portableModuleIdentityWithoutExtension(postgresRlsEmitterFile);
  for (const resolved of moduleSpecifierPathInterpretations(fileName, specifier)) {
    if (filesystemModuleIdentityMatchesEmitter(rootDir, resolved)) return true;
    if (portableModuleIdentityWithoutExtension(resolved) === emitterIdentity) return true;
  }
  return false;
}

function moduleSpecifierPathInterpretations(fileName, specifier) {
  const spellings = [specifier, specifier.replaceAll('\\', '/')];
  const suffixIndex = specifier.search(/[?#]/u);
  const urlPath = suffixIndex < 0 ? specifier : specifier.slice(0, suffixIndex);
  try {
    const decodedUrlPath = decodeURIComponent(urlPath);
    spellings.push(decodedUrlPath, decodedUrlPath.replaceAll('\\', '/'));
  } catch {
    // Malformed URL encoding is still a valid literal CJS filename on POSIX.
  }
  const resolved = [];
  for (const spelling of spellings) {
    const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(fileName), spelling));
    if (!resolved.includes(candidate)) resolved.push(candidate);
  }
  return resolved;
}

/**
 * Compare source-module identities conservatively across supported filesystems. Case-insensitive
 * APFS resolves Unicode case-fold aliases such as U+017F LONG S to ASCII `s`; lowercasing alone
 * misses that loader path. Compatibility normalization plus the lower/upper/lower closure captures
 * multi-code-point and compatibility case folds while accepting only an exact emitter identity.
 */
function portableModuleIdentity(value) {
  return value.normalize('NFKC').toLowerCase().toUpperCase().toLowerCase().normalize('NFKC');
}

function portableModuleIdentityWithoutExtension(value) {
  return portableModuleIdentity(value).replace(/\.(?:[cm]?[jt]s|[jt]sx)$/u, '');
}

function filesystemModuleIdentityMatchesEmitter(rootDir, resolved) {
  let emitter;
  try {
    emitter = statSync(path.join(rootDir, postgresRlsEmitterFile), { bigint: true });
  } catch {
    return false;
  }
  for (const candidate of sourceResolutionCandidates(resolved)) {
    try {
      const resolvedStat = statSync(path.join(rootDir, candidate), { bigint: true });
      if (resolvedStat.dev === emitter.dev && resolvedStat.ino === emitter.ino) return true;
    } catch {
      // The portable identity check below owns platforms where this spelling is not loadable.
    }
  }
  return false;
}

function sourceResolutionCandidates(resolved) {
  const lastSlash = resolved.lastIndexOf('/');
  const lastDot = resolved.lastIndexOf('.');
  const extension = lastDot > lastSlash ? portableModuleIdentity(resolved.slice(lastDot + 1)) : '';
  const hasRecognizedExtension = /^(?:[cm]?[jt]s|[jt]sx)$/u.test(extension);
  if (lastDot > lastSlash && !hasRecognizedExtension) return [resolved];
  const stem = hasRecognizedExtension ? resolved.slice(0, lastDot) : resolved;
  return [
    resolved,
    ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].map(
      (candidateExtension) => `${stem}${candidateExtension}`,
    ),
    `${stem}/index.ts`,
    `${stem}/index.tsx`,
    `${stem}/index.mts`,
    `${stem}/index.cts`,
    `${stem}/index.js`,
    `${stem}/index.jsx`,
    `${stem}/index.mjs`,
    `${stem}/index.cjs`,
  ];
}

function collectEmitterCalls(sourceFile, fileName, bindings, rows, findings) {
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = node.expression;
    const direct = ts.isIdentifier(callee) && bindings.localNames.has(callee.text);
    const property = ts.isPropertyAccessExpression(callee) && callee.name.text === emitterName;
    const computedProperty =
      ts.isElementAccessExpression(callee) &&
      ts.isStringLiteralLike(callee.argumentExpression) &&
      callee.argumentExpression.text === emitterName;
    if (!direct && !property && !computedProperty) return;

    const site = emissionCallSite(node);
    rows.push({ fileName, line: lineOf(sourceFile, node), site });
    if (fileName !== postgresRlsRuntimeFile) {
      findings.push(
        `${fileName}:${lineOf(sourceFile, node)}: ${emitterName}() may be called only by ${postgresRlsRuntimeFile}`,
      );
    }
    if (!ts.isIdentifier(callee) || callee.text !== emitterName) {
      findings.push(
        `${fileName}:${lineOf(sourceFile, node)}: RLS emission must use the direct reviewed ${emitterName}() binding`,
      );
    }
    if (site === undefined) {
      findings.push(
        `${fileName}:${lineOf(sourceFile, node)}: ${emitterName}() requires one object literal with a literal site`,
      );
    }
  });
}

function collectEmitterBindingEscapes(sourceFile, fileName, bindings, findings) {
  if (fileName === postgresRlsEmitterFile) return;
  walk(sourceFile, (node) => {
    if (!ts.isIdentifier(node) || !bindings.localNames.has(node.text)) return;
    const parent = node.parent;
    if (ts.isImportSpecifier(parent)) return;
    if (ts.isCallExpression(parent) && parent.expression === node) return;
    findings.push(
      `${fileName}:${lineOf(sourceFile, node)}: ${node.text} may not escape its direct reviewed call position`,
    );
  });
}

function emissionCallSite(call) {
  if (call.arguments.length !== 1 || !ts.isObjectLiteralExpression(call.arguments[0])) {
    return undefined;
  }
  const siteProperties = call.arguments[0].properties.filter(
    (property) => ts.isPropertyAssignment(property) && propertyName(property.name) === 'site',
  );
  if (siteProperties.length !== 1) return undefined;
  const initializer = siteProperties[0].initializer;
  return ts.isStringLiteralLike(initializer) ? initializer.text : undefined;
}

function validateRuntimeCalls(rows, findings) {
  const runtimeRows = rows.filter((row) => row.fileName === postgresRlsRuntimeFile);
  const sites = runtimeRows
    .map((row) => row.site ?? '<dynamic>')
    .sort((left, right) => left.localeCompare(right));
  const expected = [...postgresRlsEmissionSites].sort((left, right) => left.localeCompare(right));
  if (!equalArrays(sites, expected)) {
    findings.push(
      `${postgresRlsRuntimeFile}: expected exactly five RLS constructor calls [${expected.join(', ')}], found [${sites.join(', ')}]`,
    );
  }
}

function findFunctionDeclaration(sourceFile, name) {
  return sourceFile.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
}

function enclosingFunctionName(node) {
  let current = node.parent;
  while (current !== undefined) {
    if (ts.isFunctionDeclaration(current)) return current.name?.text;
    current = current.parent;
  }
  return undefined;
}

function enclosingCaseName(node) {
  let current = node.parent;
  while (current !== undefined) {
    if (ts.isCaseClause(current)) {
      return ts.isStringLiteralLike(current.expression) ? current.expression.text : '?';
    }
    if (ts.isFunctionLike(current) && enclosingFunctionName(current) !== emitterName) break;
    current = current.parent;
  }
  return '<outside-switch>';
}

function isStringToken(node) {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    node.kind === ts.SyntaxKind.TemplateHead ||
    node.kind === ts.SyntaxKind.TemplateMiddle ||
    node.kind === ts.SyntaxKind.TemplateTail
  );
}

function containsDirectPolicyMutationLiteral(node) {
  let found = false;
  walk(node, (child) => {
    if (isStringToken(child) && postgresPolicyMutationKeyword(child.text) !== undefined)
      found = true;
  });
  return found;
}

function isStaticStringComposition(node) {
  return (
    ts.isBinaryExpression(node) ||
    ts.isTemplateExpression(node) ||
    ts.isCallExpression(node) ||
    ts.isTaggedTemplateExpression(node)
  );
}

function evaluateStaticString(node, checker, seen = new Set()) {
  const current = unwrapExpression(node);
  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return current.text;
  }
  if (ts.isIdentifier(current)) {
    const declaration = staticConstDeclaration(checker, current);
    if (declaration?.initializer === undefined || seen.has(declaration)) return undefined;
    const nextSeen = new Set(seen);
    nextSeen.add(declaration);
    return evaluateStaticString(declaration.initializer, checker, nextSeen);
  }
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = evaluateStaticString(current.left, checker, seen);
    const right = evaluateStaticString(current.right, checker, seen);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (ts.isTemplateExpression(current)) {
    let result = current.head.text;
    for (const span of current.templateSpans) {
      const expression = evaluateStaticString(span.expression, checker, seen);
      if (expression === undefined) return undefined;
      result += expression + span.literal.text;
    }
    return result;
  }
  if (ts.isTaggedTemplateExpression(current)) {
    return evaluateStaticString(current.template, checker, seen);
  }
  if (ts.isCallExpression(current)) {
    if (
      ts.isIdentifier(current.expression) &&
      current.expression.text === 'String' &&
      current.arguments.length === 1
    ) {
      return evaluateStaticString(current.arguments[0], checker, seen);
    }
    if (!ts.isPropertyAccessExpression(current.expression)) return undefined;
    const receiver = current.expression.expression;
    if (current.expression.name.text === 'join' && current.arguments.length <= 1) {
      const values = evaluateStaticStringArray(receiver, checker, seen);
      const separator =
        current.arguments.length === 0
          ? ','
          : evaluateStaticString(current.arguments[0], checker, seen);
      return values === undefined || separator === undefined ? undefined : values.join(separator);
    }
    if (current.expression.name.text === 'concat') {
      const head = evaluateStaticString(receiver, checker, seen);
      if (head === undefined) return undefined;
      let result = head;
      for (const argument of current.arguments) {
        const value = evaluateStaticString(argument, checker, seen);
        if (value === undefined) return undefined;
        result += value;
      }
      return result;
    }
  }
  return undefined;
}

function evaluateStaticStringArray(node, checker, seen) {
  const current = unwrapExpression(node);
  if (ts.isIdentifier(current)) {
    const declaration = staticConstDeclaration(checker, current);
    if (declaration?.initializer === undefined || seen.has(declaration)) return undefined;
    const nextSeen = new Set(seen);
    nextSeen.add(declaration);
    return evaluateStaticStringArray(declaration.initializer, checker, nextSeen);
  }
  if (!ts.isArrayLiteralExpression(current)) return undefined;
  const values = [];
  for (const element of current.elements) {
    if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) return undefined;
    const value = evaluateStaticString(element, checker, seen);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values;
}

function staticConstDeclaration(checker, identifier) {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (symbol === undefined) return undefined;
  const declarations = symbol.declarations?.filter(
    (declaration) =>
      ts.isVariableDeclaration(declaration) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0,
  );
  return declarations?.length === 1 ? declarations[0] : undefined;
}

function postgresPolicyMutationKeyword(value) {
  for (let index = 0; index < value.length; index += 1) {
    for (const keyword of ['CREATE', 'ALTER', 'DROP']) {
      if (!sqlKeywordAt(value, index, keyword)) continue;
      const afterKeyword = index + keyword.length;
      const afterTrivia = skipPostgresTrivia(value, afterKeyword);
      if (afterTrivia === afterKeyword) continue;
      if (sqlKeywordAt(value, afterTrivia, 'POLICY')) return keyword;
    }
  }
  return undefined;
}

function sqlKeywordAt(value, index, keyword) {
  if (index > 0 && isPostgresIdentifierPart(value[index - 1])) return false;
  if (value.slice(index, index + keyword.length).toUpperCase() !== keyword) return false;
  return !isPostgresIdentifierPart(value[index + keyword.length]);
}

function isPostgresIdentifierPart(value) {
  return value !== undefined && /[A-Z0-9_$]/iu.test(value);
}

function skipPostgresTrivia(value, start) {
  let index = start;
  while (index < value.length) {
    const whitespace = /\s/u.exec(value.slice(index));
    if (whitespace?.index === 0) {
      index += whitespace[0].length;
      continue;
    }
    if (value.startsWith('--', index)) {
      const newline = value.indexOf('\n', index + 2);
      index = newline < 0 ? value.length : newline + 1;
      continue;
    }
    if (!value.startsWith('/*', index)) break;
    let depth = 1;
    index += 2;
    while (index < value.length && depth > 0) {
      if (value.startsWith('/*', index)) {
        depth += 1;
        index += 2;
      } else if (value.startsWith('*/', index)) {
        depth -= 1;
        index += 2;
      } else {
        index += 1;
      }
    }
  }
  return index;
}

function unwrapExpression(node) {
  let current = node;
  while (
    current !== undefined &&
    (ts.isAsExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(name) {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function equalArrays(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function slash(value) {
  return value.split(path.sep).join('/');
}

if (isMainEntry(import.meta.url)) {
  await runGate(main);
}
