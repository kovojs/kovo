#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot } from './lib/repo-root.mjs';

export const asyncContextConfinementSchema = 'kovo.async-context-confinement/v1';
export const asyncContextConfinementPath = 'security/async-context-confinement.json';

const contractFunctionNames = new Set([
  'bindCurrentJsxRequestContext',
  'createFrameworkAsyncContextCell',
  'currentFrameworkAsyncContextValue',
  'runInFreshFrameworkAsyncContext',
  'runWithFrameworkAsyncContext',
  'runWithIsolatedFrameworkAsyncContext',
  'runWithRevocableIsolatedFrameworkAsyncContext',
]);
const cellUseFunctions = new Set([
  'currentFrameworkAsyncContextValue',
  'runWithFrameworkAsyncContext',
  'runWithIsolatedFrameworkAsyncContext',
  'runWithRevocableIsolatedFrameworkAsyncContext',
]);
const serverIntrinsicPath = 'packages/server/src/jsx-form-helper-intrinsics.ts';
const verifierIntrinsicPath = 'packages/test/src/verifier-security-intrinsics.ts';
const verifierObserverPath = 'packages/test/src/verifier-observation.ts';

export function loadAsyncContextConfinementInput({ rootDir = repoRoot() } = {}) {
  const document = JSON.parse(
    readFileSync(path.join(rootDir, asyncContextConfinementPath), 'utf8'),
  );
  const files = collectProductionSources(rootDir);
  if (typeof document?.oracle?.path === 'string') {
    files.set(document.oracle.path, readFileSync(path.join(rootDir, document.oracle.path), 'utf8'));
  }
  return { document, files };
}

export function validateAsyncContextConfinement({ document, files, rootDir = repoRoot() } = {}) {
  const findings = [];
  const loaded =
    document === undefined || files === undefined
      ? loadAsyncContextConfinementInput({ rootDir })
      : undefined;
  const census = document ?? loaded.document;
  const sources = files ?? loaded.files;

  if (census?.schema !== asyncContextConfinementSchema) {
    findings.push(
      `${asyncContextConfinementPath}: schema must be ${asyncContextConfinementSchema}`,
    );
    return result(findings);
  }
  if (!Array.isArray(census.cells) || census.cells.length === 0) {
    findings.push(`${asyncContextConfinementPath}: cells must be a non-empty array`);
    return result(findings);
  }

  const rowsById = new Map();
  const rowsBySite = new Map();
  for (const row of census.cells) {
    if (!validCellRow(row)) {
      findings.push(`${asyncContextConfinementPath}: malformed cell row ${JSON.stringify(row)}`);
      continue;
    }
    if (rowsById.has(row.id)) findings.push(`${row.id}: duplicate async-context cell id`);
    const site = `${row.path}#${row.binding}`;
    if (rowsBySite.has(site)) findings.push(`${site}: duplicate async-context cell site`);
    rowsById.set(row.id, row);
    rowsBySite.set(site, row);
  }

  const derivedSites = new Map();
  const productionSourceFiles = new Map();
  for (const [fileName, source] of sources) {
    if (isTestSource(fileName)) continue;
    scanForbiddenAsyncStorageDoors(fileName, source, findings);
    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    productionSourceFiles.set(fileName, sourceFile);
    rejectContractAliases(sourceFile, fileName, findings);
    collectCellSites(sourceFile, fileName, rowsBySite, derivedSites, findings);
  }

  for (const [site, row] of rowsBySite) {
    const derived = derivedSites.get(site);
    if (derived === undefined) {
      findings.push(`${site}: censused async-context cell declaration is missing`);
      continue;
    }
    if (derived.id !== row.id) {
      findings.push(`${site}: derived id ${derived.id} does not match census ${row.id}`);
    }
    const requiredRunner =
      row.mode === 'isolated'
        ? 'runWithIsolatedFrameworkAsyncContext'
        : 'runWithFrameworkAsyncContext';
    if (!derived.uses.has(requiredRunner)) {
      findings.push(`${site}: ${row.mode} cell never uses ${requiredRunner}`);
    }
    if (!derived.uses.has('currentFrameworkAsyncContextValue')) {
      findings.push(`${site}: cell has no exact current-lifecycle read`);
    }
  }
  for (const [site, derived] of derivedSites) {
    if (!rowsBySite.has(site)) {
      findings.push(`${site}: uncensused async-context cell ${derived.id}`);
    }
  }

  validateContract(census.contract, sources, findings);
  validateFreshLifecycleRoots(census.contract, productionSourceFiles, findings);
  validateOwnedReentries(census.ownedReentries, sources, productionSourceFiles, rowsById, findings);
  validateVerifierObserver(census.reviewedNonRuntimeCarriers, sources, findings);
  validateOracle(census.oracle, sources, census.cells.length + 1, findings);

  return result(findings, {
    cells: census.cells.length + 1,
    runtimeAuthorityCells: census.cells.length,
    reviewedNonRuntimeCarriers: census.reviewedNonRuntimeCarriers?.length ?? 0,
  });
}

function validateOwnedReentries(rows, sources, sourceFiles, cellsById, findings) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    findings.push(
      `${asyncContextConfinementPath}: exactly one owned async-context re-entry is required`,
    );
    return;
  }
  const row = rows[0];
  if (
    row?.cellId !== 'server.jsx-request' ||
    row?.binding !== 'bindCurrentJsxRequestContext' ||
    row?.definitionPath !== 'packages/server/src/jsx-context.ts' ||
    row?.consumerPath !== 'packages/server/src/deferred-region.ts' ||
    typeof row?.purpose !== 'string' ||
    row.purpose.length < 96 ||
    !cellsById.has(row.cellId)
  ) {
    findings.push(`${asyncContextConfinementPath}: malformed owned async-context re-entry`);
    return;
  }

  const definition = sources.get(row.definitionPath) ?? '';
  for (const token of [
    `export function ${row.binding}<Result>(`,
    'const context = currentFrameworkAsyncContextValue(jsxRequestContext);',
    'let started = false;',
    'if (started) {',
    'started = true;',
    'runWithRevocableIsolatedFrameworkAsyncContext(jsxRequestContext, context, callback)',
  ]) {
    if (!definition.includes(token)) {
      findings.push(`${row.definitionPath}: owned JSX re-entry lost isolated exact-cell binding`);
    }
  }

  const consumer = sources.get(row.consumerPath) ?? '';
  validateOwnedReentryReferences(row, sourceFiles, findings);
  const orderedTokens = [
    "if (priority === 'critical') return renderNow();",
    'if (!collector) return renderNow();',
    `const startDeferredRegion = ${row.binding}(renderRegion);`,
    `const startErrorChunk = ${row.binding}(() =>`,
  ];
  const orderedPositions = orderedTokens.map((token) => consumer.indexOf(token));
  if (
    orderedPositions.some((position) => position === -1) ||
    orderedPositions.some((position, index) => index > 0 && position <= orderedPositions[index - 1])
  ) {
    findings.push(
      `${row.consumerPath}: owned JSX re-entry must remain below critical and no-collector exits`,
    );
  }
  if (
    (consumer.match(/\bstartDeferredRegion\b/gu) ?? []).length !== 2 ||
    (consumer.match(/\bstartErrorChunk\b/gu) ?? []).length !== 2 ||
    !consumer.includes('revokeDeferredRegion = () => task.revoke();') ||
    !consumer.includes('revokeDeferredRegion();') ||
    !consumer.includes('let winnerSelected = false;') ||
    !consumer.includes('if (winnerSelected) return;') ||
    !consumer.includes('winnerSelected = true;')
  ) {
    findings.push(
      `${row.consumerPath}: deferred success, error, and timeout must select one owned JSX re-entry`,
    );
  }
  for (const [fileName, source] of sources) {
    if (fileName === row.definitionPath || fileName === row.consumerPath) continue;
    if (new RegExp(`\\b${escapeRegExp(row.binding)}\\b`, 'u').test(source)) {
      findings.push(`${fileName}: unauthorized owned JSX re-entry consumer`);
    }
  }

  const expectedCalls = new Map([[`${row.cellId}:${row.definitionPath}#${row.binding}`, 1]]);
  const actualCalls = new Map();
  for (const cell of cellsById.values()) {
    if (cell.mode !== 'shared') continue;
    const sourceFile = sourceFiles.get(cell.path);
    if (sourceFile === undefined) continue;
    const inspect = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === 'runWithIsolatedFrameworkAsyncContext' ||
          node.expression.text === 'runWithRevocableIsolatedFrameworkAsyncContext') &&
        ts.isIdentifier(node.arguments[0]) &&
        node.arguments[0].text === cell.binding
      ) {
        const owner = enclosingFunctionName(node) ?? '<module>';
        const key = `${cell.id}:${cell.path}#${owner}`;
        actualCalls.set(key, (actualCalls.get(key) ?? 0) + 1);
        if (hasIterationAncestorBeforeFunction(node, owner)) {
          findings.push(`${key}: isolated re-entry cannot execute from an iteration statement`);
        }
      }
      ts.forEachChild(node, inspect);
    };
    inspect(sourceFile);
  }
  for (const [key, count] of actualCalls) {
    if (expectedCalls.get(key) !== count) {
      findings.push(`${key}: uncensused isolated re-entry for shared async-context cell`);
    }
  }
  for (const [key, count] of expectedCalls) {
    if (actualCalls.get(key) !== count) {
      findings.push(`${key}: owned async-context re-entry call is missing or duplicated`);
    }
  }
}

function validateOwnedReentryReferences(row, sourceFiles, findings) {
  const calls = [];
  let definitions = 0;
  let imports = 0;
  for (const [fileName, sourceFile] of sourceFiles) {
    const visit = (node) => {
      if (ts.isIdentifier(node) && node.text === row.binding) {
        const parent = node.parent;
        if (
          fileName === row.definitionPath &&
          ts.isFunctionDeclaration(parent) &&
          parent.name === node
        ) {
          definitions += 1;
        } else if (
          ts.isImportSpecifier(parent) &&
          parent.name === node &&
          (parent.propertyName?.text ?? parent.name.text) === row.binding
        ) {
          imports += 1;
          if (fileName !== row.consumerPath) {
            findings.push(`${fileName}: unauthorized owned JSX re-entry import`);
          }
        } else if (ts.isCallExpression(parent) && parent.expression === node) {
          calls.push({ call: parent, fileName, sourceFile });
        } else {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          findings.push(`${fileName}:${line}: unauthorized owned JSX re-entry reference`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  if (definitions !== 1 || imports !== 1 || calls.length !== 2) {
    findings.push(
      `${row.binding}: expected one definition, one consumer import, and two exact registrations; found definitions=${definitions} imports=${imports} calls=${calls.length}`,
    );
  }

  const expectedBindings = new Map([
    ['startDeferredRegion', 'renderRegion'],
    ['startErrorChunk', '<arrow>'],
  ]);
  for (const { call, fileName } of calls) {
    const binding = directConstBindingForCall(call, 'lowerDeferredRegion');
    const expectedArgument = binding === undefined ? undefined : expectedBindings.get(binding);
    const argument = call.arguments[0];
    const argumentMatches =
      expectedArgument === '<arrow>'
        ? argument !== undefined && ts.isArrowFunction(argument)
        : expectedArgument !== undefined &&
          argument !== undefined &&
          ts.isIdentifier(argument) &&
          argument.text === expectedArgument;
    if (fileName !== row.consumerPath || !argumentMatches) {
      findings.push(
        `${fileName}: owned JSX re-entry registrations must be the two direct lowerDeferredRegion const bindings`,
      );
      continue;
    }
    expectedBindings.delete(binding);
  }
  if (expectedBindings.size !== 0) {
    findings.push(`${row.consumerPath}: owned JSX re-entry registration bindings are incomplete`);
  }
}

function directConstBindingForCall(call, ownerName) {
  const declaration = call.parent;
  if (
    !ts.isVariableDeclaration(declaration) ||
    declaration.initializer !== call ||
    !ts.isIdentifier(declaration.name)
  ) {
    return undefined;
  }
  const declarationList = declaration.parent;
  const statement = declarationList.parent;
  if (
    !ts.isVariableDeclarationList(declarationList) ||
    (declarationList.flags & ts.NodeFlags.Const) === 0 ||
    !ts.isVariableStatement(statement)
  ) {
    return undefined;
  }
  const owner = enclosingFunctionDeclaration(call, ownerName);
  if (owner === undefined || statement.parent !== owner.body) return undefined;
  return declaration.name.text;
}

function enclosingFunctionDeclaration(node, expectedName) {
  let current = node.parent;
  while (current !== undefined) {
    if (
      ts.isFunctionDeclaration(current) &&
      current.name?.text === expectedName &&
      current.body !== undefined
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function hasIterationAncestorBeforeFunction(node, ownerName) {
  let current = node.parent;
  while (current !== undefined) {
    if (
      ts.isForStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isForOfStatement(current) ||
      ts.isWhileStatement(current) ||
      ts.isDoStatement(current)
    ) {
      return true;
    }
    if (ts.isFunctionDeclaration(current) && current.name?.text === ownerName) return false;
    current = current.parent;
  }
  return false;
}

function enclosingFunctionName(node) {
  let current = node.parent;
  while (current !== undefined) {
    if (ts.isFunctionDeclaration(current) && current.name !== undefined) return current.name.text;
    if (
      (ts.isMethodDeclaration(current) || ts.isFunctionExpression(current)) &&
      current.name !== undefined &&
      ts.isIdentifier(current.name)
    ) {
      return current.name.text;
    }
    current = current.parent;
  }
  return undefined;
}

function collectProductionSources(rootDir) {
  const files = new Map();
  const packagesRoot = path.join(rootDir, 'packages');
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'dist' ||
          entry.name === 'node_modules' ||
          entry.name === 'fixtures' ||
          entry.name === 'templates'
        ) {
          continue;
        }
        visit(absolute);
        continue;
      }
      if (!entry.isFile() || !/\.(?:ts|tsx)$/u.test(entry.name)) continue;
      if (/\.(?:test|spec)\.(?:ts|tsx)$/u.test(entry.name)) continue;
      const relative = normalizePath(path.relative(rootDir, absolute));
      if (!relative.includes('/src/')) continue;
      files.set(relative, readFileSync(absolute, 'utf8'));
    }
  };
  visit(packagesRoot);
  return files;
}

function scanForbiddenAsyncStorageDoors(fileName, source, findings) {
  const allowedIntrinsic = fileName === serverIntrinsicPath || fileName === verifierIntrinsicPath;
  if (
    source.includes('async_hooks') &&
    !allowedIntrinsic &&
    !(
      fileName === 'packages/server/src/async-context.ts' &&
      /import\s+type\s+\{\s*AsyncLocalStorage\s*\}\s+from\s+['"](?:node:)?async_hooks['"]/u.test(
        source,
      )
    )
  ) {
    findings.push(
      `${fileName}: raw node:async_hooks access bypasses the shared confinement contract`,
    );
  }
  if (
    fileName !== 'packages/server/src/async-context.ts' &&
    fileName !== serverIntrinsicPath &&
    source.includes('formHelperCreateAsyncLocalStorage')
  ) {
    findings.push(`${fileName}: direct server AsyncLocalStorage factory use is forbidden`);
  }
  if (
    fileName !== verifierObserverPath &&
    fileName !== verifierIntrinsicPath &&
    source.includes('verifierAsyncStorage')
  ) {
    findings.push(`${fileName}: direct verifier AsyncLocalStorage factory use is forbidden`);
  }
  if (allowedIntrinsic) return;
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const asyncStorageBindings = new Set(['AsyncLocalStorage', 'NativeAsyncLocalStorage']);
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      (statement.moduleSpecifier.text !== 'node:async_hooks' &&
        statement.moduleSpecifier.text !== 'async_hooks')
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      if ((specifier.propertyName?.text ?? specifier.name.text) === 'AsyncLocalStorage') {
        asyncStorageBindings.add(specifier.name.text);
      }
    }
  }
  const visit = (node) => {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      asyncStorageBindings.has(node.expression.text)
    ) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      findings.push(`${fileName}:${line}: raw AsyncLocalStorage construction is forbidden`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function rejectContractAliases(sourceFile, fileName, findings) {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.namedBindings === undefined) continue;
    if (
      ts.isNamespaceImport(clause.namedBindings) &&
      /(?:^|\/)async-context\.js$/u.test(statement.moduleSpecifier.text)
    ) {
      findings.push(`${fileName}: async-context namespace imports are forbidden`);
      continue;
    }
    if (!ts.isNamedImports(clause.namedBindings)) continue;
    for (const specifier of clause.namedBindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (contractFunctionNames.has(imported) && specifier.name.text !== imported) {
        findings.push(
          `${fileName}: async-context contract alias ${specifier.name.text} -> ${imported} is forbidden`,
        );
      }
    }
  }
}

function collectCellSites(sourceFile, fileName, rowsBySite, derivedSites, findings) {
  const declarations = [];
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const call = unwrapCall(node.initializer);
      if (
        call !== undefined &&
        ts.isIdentifier(call.expression) &&
        call.expression.text === 'createFrameworkAsyncContextCell'
      ) {
        const id = call.arguments[0];
        if (id === undefined || !ts.isStringLiteralLike(id)) {
          findings.push(
            `${fileName}: async-context cell ${node.name.text} must have one literal stable id`,
          );
        } else {
          declarations.push({ declaration: node.name, id: id.text, name: node.name.text });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  for (const declared of declarations) {
    const site = `${fileName}#${declared.name}`;
    const uses = new Set();
    const inspect = (node) => {
      if (ts.isIdentifier(node) && node.text === declared.name && node !== declared.declaration) {
        const parent = node.parent;
        const allowed =
          ts.isCallExpression(parent) &&
          parent.arguments[0] === node &&
          ts.isIdentifier(parent.expression) &&
          cellUseFunctions.has(parent.expression.text);
        if (!allowed) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          findings.push(
            `${fileName}:${line}: async-context cell ${declared.name} escapes its reviewed contract call`,
          );
        } else {
          uses.add(parent.expression.text);
        }
      }
      ts.forEachChild(node, inspect);
    };
    inspect(sourceFile);
    if (derivedSites.has(site)) findings.push(`${site}: duplicate derived cell declaration`);
    derivedSites.set(site, { id: declared.id, uses });
    const row = rowsBySite.get(site);
    if (row !== undefined && row.id !== declared.id) {
      findings.push(`${site}: literal id ${declared.id} does not match census ${row.id}`);
    }
  }
}

function validateContract(contract, sources, findings) {
  if (
    contract?.path !== 'packages/server/src/async-context.ts' ||
    contract?.lifecycleId !== 'framework.lifecycle' ||
    typeof contract?.rootBoundary !== 'string'
  ) {
    findings.push(`${asyncContextConfinementPath}: malformed shared contract declaration`);
    return;
  }
  const source = sources.get(contract.path);
  if (source === undefined) {
    findings.push(`${contract.path}: shared confinement contract is missing`);
    return;
  }
  const required = [
    ['module-private cell brand', 'const frameworkAsyncContextCellBrand: unique symbol'],
    [
      'module-private revocable task brand',
      'const revocableFrameworkAsyncContextTaskBrand: unique symbol',
    ],
    ['private lifecycle carrier', 'const frameworkAsyncContextLifecycleStorage ='],
    ['private cell ownership map', 'const frameworkAsyncContextCellStates = createWitnessWeakMap<'],
    ['closed-lifecycle witness', 'const closedFrameworkAsyncContextLifecycles ='],
    ['exact lifecycle comparison', 'lifecycle !== store.lifecycle'],
    ['stale-read rejection', 'witnessWeakSetHas(closedFrameworkAsyncContextLifecycles, lifecycle)'],
    ['stale re-entry rejection', 'detached work cannot reacquire'],
    ['isolated root', 'runOwnedFrameworkAsyncContextLifecycle((lifecycle) =>'],
    ['revocable isolated root', 'runWithRevocableIsolatedFrameworkAsyncContext<Value, Result>'],
    [
      'explicit isolated revocation',
      'revoke: () => closeFrameworkAsyncContextLifecycle(lifecycle)',
    ],
    ['synchronous close', 'closeFrameworkAsyncContextLifecycle(lifecycle);\n  return result;'],
  ];
  for (const [label, token] of required) {
    if (!source.includes(token)) findings.push(`${contract.path}: missing ${label}`);
  }
  if ((source.match(/closeFrameworkAsyncContextLifecycle\(lifecycle\);/gu) ?? []).length < 4) {
    findings.push(
      `${contract.path}: lifecycle must close on throw, resolve, reject, and sync return`,
    );
  }

  const [rootPath, rootName] = contract.rootBoundary.split('#');
  const rootSource = sources.get(rootPath);
  if (
    rootSource === undefined ||
    !new RegExp(
      `function\\s+${escapeRegExp(rootName)}[\\s\\S]{0,300}?runInFreshFrameworkAsyncContext\\(callback\\)`,
      'u',
    ).test(rootSource)
  ) {
    findings.push(`${contract.rootBoundary}: request root does not establish a fresh lifecycle`);
  }

  const serverIntrinsic = sources.get(serverIntrinsicPath) ?? '';
  const verifierIntrinsic = sources.get(verifierIntrinsicPath) ?? '';
  if ((serverIntrinsic.match(/new NativeAsyncLocalStorage</gu) ?? []).length !== 2) {
    findings.push(`${serverIntrinsicPath}: expected one self-test and one private factory door`);
  }
  if ((verifierIntrinsic.match(/new NativeAsyncLocalStorage</gu) ?? []).length !== 2) {
    findings.push(
      `${verifierIntrinsicPath}: expected one self-test and one verifier observer door`,
    );
  }
}

function validateFreshLifecycleRoots(contract, sourceFiles, findings) {
  const [rootPath, rootName] = contract.rootBoundary.split('#');
  const functionName = 'runInFreshFrameworkAsyncContext';
  const calls = [];
  let definitions = 0;
  let imports = 0;

  for (const [fileName, sourceFile] of sourceFiles) {
    const visit = (node) => {
      if (ts.isIdentifier(node) && node.text === functionName) {
        const parent = node.parent;
        if (
          fileName === contract.path &&
          ts.isFunctionDeclaration(parent) &&
          parent.name === node
        ) {
          definitions += 1;
        } else if (
          ts.isImportSpecifier(parent) &&
          parent.name === node &&
          (parent.propertyName?.text ?? parent.name.text) === functionName
        ) {
          imports += 1;
          if (fileName !== rootPath) {
            findings.push(`${fileName}: unauthorized fresh async-context root import`);
          }
        } else if (ts.isCallExpression(parent) && parent.expression === node) {
          calls.push({ call: parent, fileName });
        } else {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          findings.push(`${fileName}:${line}: unauthorized fresh async-context root reference`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  if (definitions !== 1 || imports !== 1 || calls.length !== 1) {
    findings.push(
      `${functionName}: expected one definition, one root import, and one exact call; found definitions=${definitions} imports=${imports} calls=${calls.length}`,
    );
  }
  const only = calls[0];
  if (
    only === undefined ||
    only.fileName !== rootPath ||
    enclosingFunctionName(only.call) !== rootName ||
    !isDirectFunctionReturn(only.call, rootName) ||
    hasIterationAncestorBeforeFunction(only.call, rootName)
  ) {
    findings.push(`${contract.rootBoundary}: fresh lifecycle root must be one direct return`);
  }
}

function isDirectFunctionReturn(call, ownerName) {
  const statement = call.parent;
  if (!ts.isReturnStatement(statement) || statement.expression !== call) return false;
  const owner = enclosingFunctionDeclaration(call, ownerName);
  return owner !== undefined && statement.parent === owner.body;
}

function validateVerifierObserver(rows, sources, findings) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    findings.push(
      `${asyncContextConfinementPath}: exactly one reviewed non-runtime carrier is required`,
    );
    return;
  }
  const row = rows[0];
  if (
    row?.id !== 'test.verifier-observation' ||
    row?.path !== verifierObserverPath ||
    row?.role !== 'verification-observer' ||
    typeof row?.reason !== 'string' ||
    row.reason.length < 48
  ) {
    findings.push(`${asyncContextConfinementPath}: malformed verifier observer exception`);
    return;
  }
  const source = sources.get(verifierObserverPath) ?? '';
  for (const token of [
    'const storage = verifierAsyncStorage<ObservationScope>();',
    'scope.active = false;',
    'request-scoped DB authority is revoked',
  ]) {
    if (!source.includes(token)) {
      findings.push(`${verifierObserverPath}: missing reviewed verifier revocation token ${token}`);
    }
  }
}

function validateOracle(oracle, sources, expectedLogicalCells, findings) {
  if (
    oracle?.path !== 'packages/server/src/async-context.test.ts' ||
    typeof oracle?.test !== 'string' ||
    oracle?.seed !== '0x4b564f56' ||
    oracle?.requests !== 24 ||
    oracle?.logicalCells !== expectedLogicalCells
  ) {
    findings.push(`${asyncContextConfinementPath}: malformed non-interference oracle declaration`);
    return;
  }
  const source = sources.get(oracle.path) ?? '';
  if (
    !source.includes(oracle.test) ||
    !source.includes('queueMicrotask') ||
    !source.includes('ReadableStream') ||
    !source.includes('thenableCheckpoint') ||
    !source.includes('requestCount = 24') ||
    !source.includes('cellCount = 8')
  ) {
    findings.push(`${oracle.path}: seeded concurrency oracle lost a required interleaving family`);
  }
}

function validCellRow(row) {
  return (
    row !== null &&
    typeof row === 'object' &&
    typeof row.id === 'string' &&
    typeof row.path === 'string' &&
    typeof row.binding === 'string' &&
    (row.mode === 'isolated' || row.mode === 'shared') &&
    typeof row.role === 'string'
  );
}

function isTestSource(fileName) {
  return /\.(?:test|spec)\.(?:ts|tsx|js|mjs)$/u.test(fileName);
}

function unwrapCall(expression) {
  let value = expression;
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isSatisfiesExpression(value) ||
    ts.isTypeAssertionExpression(value)
  ) {
    value = value.expression;
  }
  return ts.isCallExpression(value) ? value : undefined;
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function result(findings, summary = {}) {
  return { findings, ok: findings.length === 0, summary };
}

export function runAsyncContextConfinementCheck(options = {}) {
  const check = validateAsyncContextConfinement(options);
  if (check.ok) {
    process.stdout.write(
      `check-async-context-confinement/v1\nOK cells=${check.summary.cells} runtime=${check.summary.runtimeAuthorityCells} reviewedNonRuntime=${check.summary.reviewedNonRuntimeCarriers}\n`,
    );
    return 0;
  }
  process.stderr.write(
    `check-async-context-confinement/v1\nFAIL findings=${check.findings.length}:\n${check.findings
      .map((finding) => `- ${finding}`)
      .join('\n')}\n`,
  );
  return 1;
}

async function main() {
  process.exitCode = runAsyncContextConfinementCheck();
}

if (isMainEntry(import.meta.url)) await runGate(main);
