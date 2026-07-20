#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();
export const emissionModuleSpecifier = '@kovojs/core/internal/emission';
export const emissionDoorPath = 'packages/core/src/internal/emission.ts';

const constructorNames = Object.freeze([
  'importSpecifier',
  'jsIdentifier',
  'jsStringLiteral',
  'tsPropertyKey',
]);

// Plan 3 §2.3 exact migration boundary. A new consumer is a reviewed expansion of the shared
// source-emission TCB and must be added explicitly. `lower/structural-jsx.ts#emitDerive` stays out
// by the plan's normative kill list.
export const reviewedEmissionConsumers = Object.freeze({
  'packages/compiler/src/emit/registry.ts': Object.freeze(['jsStringLiteral']),
  'packages/drizzle/src/derive-codegen.ts': constructorNames,
});

const requiredConstructorCalls = Object.freeze({
  'packages/compiler/src/emit/registry.ts': Object.freeze(['jsStringLiteral(snapshot[index]!)']),
  'packages/drizzle/src/derive-codegen.ts': Object.freeze([
    'importSpecifier(options.formImport.path)',
    'jsIdentifier(options.constName)',
    'jsIdentifier(options.formImport.name)',
    'jsStringLiteral(name)',
    'jsStringLiteral(options.queue)',
    'jsStringLiteral(query)',
    'tsPropertyKey(column)',
    'tsPropertyKey(entry.name)',
    'tsPropertyKey(entry.query)',
    'tsPropertyKey(key)',
    'tsPropertyKey(query)',
  ]),
});

const forbiddenLegacyFragments = Object.freeze({
  'packages/compiler/src/emit/registry.ts': Object.freeze([
    'function registryStringLiteral',
    'registryStringLiteral(',
  ]),
  'packages/drizzle/src/derive-codegen.ts': Object.freeze([
    'function propertyKey',
    'propertyKey(',
    "queue: '${options.queue}'",
    "from '${options.formImport.path}'",
    ".map((query) => `'${query}'`)",
  ]),
});

export function loadEmissionClosureSources({ root = repoRoot } = {}) {
  const sources = {};
  for (const file of collectProductionTypeScriptFiles(path.join(root, 'packages'))) {
    const relative = normalizePath(path.relative(root, file));
    sources[relative] = readFileSync(file, 'utf8');
  }
  return sources;
}

export function evaluateEmissionConstructorClosure(sources) {
  const findings = [];
  const observedConsumers = new Map();
  const observedDefinitions = new Map(constructorNames.map((name) => [name, []]));

  for (const [fileName, source] of Object.entries(sources)) {
    const parsed = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    if (parsed.parseDiagnostics.length > 0) {
      findings.push(`${fileName}: cannot parse while checking structural emission closure`);
      continue;
    }

    for (const statement of parsed.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        isEmissionModuleSpecifier(fileName, statement.moduleSpecifier.text)
      ) {
        const bindings = statement.importClause?.namedBindings;
        if (bindings === undefined || !ts.isNamedImports(bindings)) {
          findings.push(`${fileName}: structural emission import must use reviewed named bindings`);
          continue;
        }
        const names = [];
        for (const element of bindings.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          if (element.name.text !== imported) {
            findings.push(
              `${fileName}: structural emission constructor ${imported} must not be aliased`,
            );
          }
          names.push(imported);
        }
        addObservedConsumerBindings(observedConsumers, findings, fileName, names);
      }
      if (
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        isEmissionModuleSpecifier(fileName, statement.moduleSpecifier.text)
      ) {
        const bindings = statement.exportClause;
        const names =
          bindings !== undefined && ts.isNamedExports(bindings)
            ? bindings.elements.map((element) => element.propertyName?.text ?? element.name.text)
            : ['*'];
        addObservedConsumerBindings(observedConsumers, findings, fileName, names);
        findings.push(`${fileName}: structural emission constructors must not be re-exported`);
      }
      if (
        fileName !== emissionDoorPath &&
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier === undefined &&
        statement.exportClause !== undefined &&
        ts.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.some((element) =>
          constructorNames.includes(element.propertyName?.text ?? element.name.text),
        )
      ) {
        findings.push(`${fileName}: structural emission constructors must not be re-exported`);
      }
    }

    const visit = (node) => {
      const declaredName = structuralConstructorDeclarationName(node);
      if (declaredName !== undefined) {
        observedDefinitions.get(declaredName).push(fileName);
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }

  const expectedConsumerFiles = Object.keys(reviewedEmissionConsumers).sort(compareStrings);
  const observedConsumerFiles = [...observedConsumers.keys()].sort(compareStrings);
  findings.push(
    ...exactSetFindings(
      'structural emission consumers',
      observedConsumerFiles,
      expectedConsumerFiles,
    ),
  );
  for (const fileName of expectedConsumerFiles) {
    const expected = [...reviewedEmissionConsumers[fileName]].sort(compareStrings);
    const observed = observedConsumers.get(fileName) ?? [];
    findings.push(...exactSetFindings(`${fileName} constructor imports`, observed, expected));
  }

  for (const name of constructorNames) {
    const definitions = observedDefinitions.get(name).sort(compareStrings);
    findings.push(
      ...exactSetFindings(`${name} production definitions`, definitions, [emissionDoorPath]),
    );
    if (definitions.length !== new Set(definitions).size) {
      findings.push(`${name} production definitions: duplicate declarations are not permitted`);
    }
  }

  for (const [fileName, required] of Object.entries(requiredConstructorCalls)) {
    const source = sources[fileName];
    if (typeof source !== 'string') {
      findings.push(`${fileName}: required structural emission consumer is missing`);
      continue;
    }
    const calls = constructorCallSources(fileName, source);
    for (const expected of required) {
      if (!calls.has(expected)) {
        findings.push(`${fileName}: required constructor call is missing: ${expected}`);
      }
    }
  }

  for (const [fileName, fragments] of Object.entries(forbiddenLegacyFragments)) {
    const source = sources[fileName] ?? '';
    for (const fragment of fragments) {
      if (source.includes(fragment)) {
        findings.push(`${fileName}: legacy structural emission bypass remains: ${fragment}`);
      }
    }
  }

  return {
    consumers: observedConsumerFiles.length,
    constructors: constructorNames.length,
    findings: findings.sort(),
    ok: findings.length === 0,
  };
}

function addObservedConsumerBindings(observedConsumers, findings, fileName, names) {
  const combined = [...(observedConsumers.get(fileName) ?? []), ...names];
  if (combined.length !== new Set(combined).size) {
    findings.push(`${fileName}: structural emission constructor imports must not be duplicated`);
  }
  observedConsumers.set(fileName, combined.sort(compareStrings));
}

function isEmissionModuleSpecifier(fileName, moduleSpecifier) {
  if (
    moduleSpecifier === emissionModuleSpecifier ||
    moduleSpecifier === `${emissionModuleSpecifier}.js`
  ) {
    return true;
  }
  if (!moduleSpecifier.startsWith('.')) return false;
  const resolved = path.posix
    .normalize(path.posix.join(path.posix.dirname(fileName), moduleSpecifier))
    .replace(/\.(?:[cm]?[jt]s)$/u, '');
  return resolved === emissionDoorPath.replace(/\.ts$/u, '');
}

function structuralConstructorDeclarationName(node) {
  const declarationOwner = ts.isVariableDeclaration(node) ? node.parent.parent : node;
  const exported =
    ts.canHaveModifiers(declarationOwner) &&
    ts
      .getModifiers(declarationOwner)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  if (!exported) return undefined;
  if (
    (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) &&
    node.name !== undefined &&
    constructorNames.includes(node.name.text)
  ) {
    return node.name.text;
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    constructorNames.includes(node.name.text)
  ) {
    return node.name.text;
  }
  return undefined;
}

function constructorCallSources(fileName, source) {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const calls = new Set();
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      constructorNames.includes(node.expression.text) &&
      node.arguments.length === 1
    ) {
      calls.add(`${node.expression.text}(${node.arguments[0].getText(parsed)})`);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return calls;
}

function collectProductionTypeScriptFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'dist' || entry.name === 'node_modules') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!/\.tsx?$/u.test(entry.name) || /\.(?:test|spec)\.tsx?$/u.test(entry.name)) continue;
      files.push(absolute);
    }
  };
  walk(root);
  return files.sort(compareStrings);
}

function exactSetFindings(label, observed, expected) {
  const observedSet = new Set(observed);
  const expectedSet = new Set(expected);
  const missing = [...expectedSet].filter((value) => !observedSet.has(value)).sort(compareStrings);
  const unexpected = [...observedSet]
    .filter((value) => !expectedSet.has(value))
    .sort(compareStrings);
  return [
    ...(missing.length === 0 ? [] : [`${label}: missing ${missing.join(', ')}`]),
    ...(unexpected.length === 0 ? [] : [`${label}: unexpected ${unexpected.join(', ')}`]),
  ];
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

export async function main(options = {}) {
  const result = evaluateEmissionConstructorClosure(loadEmissionClosureSources(options));
  process.stdout.write(
    `emission-constructor-closure/v1 ${result.ok ? 'OK' : 'FAIL'} constructors=${result.constructors} consumers=${result.consumers}\n`,
  );
  for (const finding of result.findings) process.stderr.write(`- ${finding}\n`);
  return result.ok;
}

if (isMainEntry(import.meta.url)) await runGate(main);
